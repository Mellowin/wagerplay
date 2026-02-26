# Install k6 on Windows
# Run as Administrator

Write-Host "Installing k6..."

# Method 1: Chocolatey (if installed)
if (Get-Command choco -ErrorAction SilentlyContinue) {
    choco install k6 -y
}
# Method 2: Winget
elseif (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install k6 --source winget
}
# Method 3: Direct download
else {
    $url = "https://github.com/grafana/k6/releases/download/v0.48.0/k6-v0.48.0-windows-amd64.msi"
    $output = "$env:TEMP\k6-installer.msi"
    
    Write-Host "Downloading k6..."
    Invoke-WebRequest -Uri $url -OutFile $output
    
    Write-Host "Installing..."
    Start-Process msiexec.exe -ArgumentList "/i", $output, "/quiet", "/norestart" -Wait
    
    Remove-Item $output
}

# Verify installation
k6 version

Write-Host "k6 installed successfully!"
Write-Host "Run: k6 run test/load/race-quickplay.js"
