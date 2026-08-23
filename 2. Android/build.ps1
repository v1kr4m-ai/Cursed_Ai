$ErrorOccurred = $false

function Fail-And-Exit {
    param([string]$Message)

    Write-Host ""
    Write-Host "ERROR: $Message" -ForegroundColor Red
    $global:ErrorOccurred = $true
}

Write-Host "Installing dependencies..."
npm install
if ($LASTEXITCODE -ne 0) {
    Fail-And-Exit "npm install failed"
}

if (-not $ErrorOccurred) {
    Write-Host "Building project..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Fail-And-Exit "npm run build failed"
    }
}

if (-not $ErrorOccurred) {
    if (Test-Path ".\android") {
        Write-Host "Android folder already exists. Skipping cap:add."
    }
    else {
        Write-Host "Adding Android platform..."
        npm run cap:add
        if ($LASTEXITCODE -ne 0) {
            Fail-And-Exit "npm run cap:add failed"
        }
    }
}

if (-not $ErrorOccurred) {
    Write-Host "Syncing Capacitor..."
    npm run cap:sync
    if ($LASTEXITCODE -ne 0) {
        Fail-And-Exit "npm run cap:sync failed"
    }
}

if (-not $ErrorOccurred) {
    Write-Host "Opening Android Studio..."
    npm run cap:open
    if ($LASTEXITCODE -ne 0) {
        Fail-And-Exit "npm run cap:open failed"
    }
}

if ($ErrorOccurred) {
    Read-Host "Press Enter to close"
    exit 1
}

exit 0