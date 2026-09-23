[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if (-not (git rev-parse --is-inside-work-tree 2>$null)) {
    throw 'Run this script from inside the Git repository.'
}

$repositoryRoot = (git rev-parse --show-toplevel).Trim()
$findings = [System.Collections.Generic.List[string]]::new()

function Add-Finding {
    param(
        [Parameter(Mandatory)] [string] $Category,
        [Parameter(Mandatory)] [string] $Location
    )

    $findings.Add("[$Category] $Location")
}

function Test-SecretText {
    param(
        [Parameter(Mandatory)] [string] $Text,
        [Parameter(Mandatory)] [string] $Location
    )

    $highConfidencePatterns = [ordered]@{
        'Private key material' = '-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'
        'Google OAuth secret' = 'GOCSPX-[A-Za-z0-9_-]{20,}'
        'GitHub token' = 'github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}'
        'AWS access key' = 'AKIA[0-9A-Z]{16}'
        'JWT-like token' = 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
    }

    foreach ($entry in $highConfidencePatterns.GetEnumerator()) {
        if ($Text -match $entry.Value) {
            Add-Finding -Category $entry.Key -Location $Location
        }
    }

    $secretAssignmentPattern = '(?im)^\s*(?<key>GOOGLE_OIDC_CLIENT_SECRET|DATABASE_PASSWORD|MYSQL_ROOT_PASSWORD|JWT_SECRET|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN)\s*[:=]\s*["'']?(?<value>[^\s"''#]+)'
    foreach ($match in [regex]::Matches($Text, $secretAssignmentPattern)) {
        $value = $match.Groups['value'].Value
        # Source code commonly maps a secret-named property from an environment object.
        # Treat only those explicit expressions and obvious public placeholders as safe.
        $safePlaceholderPattern = '^(?:replace_|change_|example|sample|placeholder|your_|dummy|test|env\.|required\(|googleValues\.|<|\$\{|x{4,})'
        if ($value -notmatch $safePlaceholderPattern) {
            Add-Finding -Category "Non-placeholder $($match.Groups['key'].Value)" -Location $Location
        }
    }
}

Push-Location -LiteralPath $repositoryRoot
try {
    # 추적 파일뿐 아니라 다음 commit에 추가될 수 있는 미추적 파일도 같은 기준으로 검사한다.
    $trackedFiles = @(
        git ls-files
        git ls-files --others --exclude-standard
    ) | Sort-Object -Unique
    $forbiddenPathPattern = '(^|/)(?:_doc|_plan|_temp|temp|tmp|\.codex)(/|$)|(^|/)\.env(?:\..+)?$|\.(?:key|p12|pfx|jks|sql|dump|bak)$'

    foreach ($relativePath in $trackedFiles) {
        $normalizedPath = $relativePath -replace '\\', '/'
        if ($normalizedPath -match $forbiddenPathPattern -and $normalizedPath -notmatch '(^|/)\.env\.sample$') {
            Add-Finding -Category 'Forbidden tracked path' -Location $normalizedPath
            continue
        }

        $absolutePath = Join-Path $repositoryRoot $relativePath
        if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
            continue
        }

        try {
            $content = Get-Content -LiteralPath $absolutePath -Raw -ErrorAction Stop
            Test-SecretText -Text $content -Location $normalizedPath
        }
        catch {
            # Binary or unreadable files are still covered by the forbidden extension checks.
        }
    }

    $stagedPatch = git diff --cached --no-ext-diff --unified=0
    if ($stagedPatch) {
        Test-SecretText -Text ($stagedPatch -join "`n") -Location 'staged diff'
    }

    $upstream = git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $upstream) {
        $outgoingPatch = git log --format=fuller --no-ext-diff -p "$($upstream.Trim())..HEAD"
        if ($outgoingPatch) {
            Test-SecretText -Text ($outgoingPatch -join "`n") -Location 'outgoing commit history'
        }
    }
    else {
        Write-Warning 'No upstream branch is configured; outgoing-history comparison was skipped.'
    }

    if ($findings.Count -gt 0) {
        Write-Error ("Public repository audit failed:`n" + (($findings | Sort-Object -Unique) -join "`n"))
        exit 1
    }

    Write-Output 'Public repository audit passed: no blocked paths or high-confidence secrets were detected.'
}
finally {
    Pop-Location
}
