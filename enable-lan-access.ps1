# enable-lan-access.ps1
# Allows external devices (Smartphones, Laptops, Tablets) on Wi-Fi / LAN to access iPerf3 Hub & SpeedTest

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   iPerf3 Hub & OpenSpeedTest - LAN Access Setup" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Get WSL IP
$wsl_raw = (wsl hostname -I).Trim()
$wsl_ip = $wsl_raw.Split(" ")[0]
if (-not $wsl_ip) {
    Write-Host "[ERROR] Could not detect WSL IP address." -ForegroundColor Red
    pause
    exit 1
}
Write-Host "[OK] Detected WSL IP: $wsl_ip" -ForegroundColor Green

# 2. Get Windows Host LAN / Wi-Fi IP
$host_ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
    $_.InterfaceAlias -notlike "*vEthernet*" -and 
    $_.InterfaceAlias -notlike "*Loopback*" -and 
    $_.IPAddress -notlike "169.254*" -and 
    $_.IPAddress -notlike "127.*" -and
    $_.InterfaceAlias -notlike "*wt*"
} | Select-Object -First 1).IPAddress

if (-not $host_ip) {
    $host_ip = "172.16.0.5"
}
Write-Host "[OK] Detected Windows Host IP: $host_ip" -ForegroundColor Green

# 3. Ports to forward to WSL
$ports = @(3001, 3002, 8001, 8088, 5201)

Write-Host "`nSetting up Windows Port Proxy (0.0.0.0 -> WSL)..." -ForegroundColor Yellow
foreach ($port in $ports) {
    netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0 2>$null | Out-Null
    netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 connectport=$port connectaddress=$wsl_ip
    Write-Host "  [+] Port $port forwarded to $wsl_ip`:$port" -ForegroundColor Gray
}

# 4. Windows Firewall Rules
Write-Host "`nConfiguring Windows Firewall..." -ForegroundColor Yellow
Remove-NetFirewallRule -DisplayName "iPerf3 Hub & SpeedTest (Inbound)" -ErrorAction SilentlyContinue 2>$null | Out-Null
New-NetFirewallRule -DisplayName "iPerf3 Hub & SpeedTest (Inbound)" -Direction Inbound -LocalPort 3001,3002,8001,8088,5201 -Protocol TCP -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
Write-Host "[OK] Windows Firewall rules added successfully." -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  SUCCESS! You can now access from your Smartphone / LAN:" -ForegroundColor Green
Write-Host "  - HTML5 SpeedTest: http://${host_ip}:3002" -ForegroundColor Cyan
Write-Host "  - Web Dashboard:   http://${host_ip}:3001" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
