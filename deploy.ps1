# 一键构建并部署到手机
$env:ANDROID_HOME = "D:\AndroidSDK"
$env:ANDROID_SDK_ROOT = "D:\AndroidSDK"
$env:JAVA_HOME = "D:\old\software\Android studio\jbr"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

Set-Location "D:\OpenClawWorkspace\purchase-app"

Write-Output "1. Copying web assets..."
Copy-Item "theme.css" "www\theme.css" -Force
Copy-Item "index.html" "www\index.html" -Force
Get-ChildItem "js\*.js" | ForEach-Object { Copy-Item $_.FullName "www\js\" -Force }

Write-Output "2. Syncing to Android..."
npx cap sync android 2>&1 | Out-Null

Write-Output "3. Building APK..."
Set-Location "android"
& .\gradlew.bat assembleDebug --no-daemon 2>&1 | Out-Null

Write-Output "4. Installing to phone..."
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk 2>&1

Set-Location "D:\OpenClawWorkspace\purchase-app"
Write-Output ""
Write-Output "Done! App should open on your phone."