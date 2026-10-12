Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "OpenCode Piggy"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\OpenCode Piggy"
InstallDirRegKey HKCU "Software\OpenCodePiggy" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenCodePiggy"
!define MUI_ICON "${STAGE}\icon.ico"
!define MUI_UNICON "${STAGE}\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_TEXT "游戏 ${GAME_VERSION} 与 OpenCode 插件已安装。重新加载 OpenCode 项目后插件生效；小猪通过桌面快捷方式独立启动。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

; 只安装到空目录或已有的本产品目录，避免卸载误删用户目录。
Function .onVerifyInstDir
  IfFileExists "$INSTDIR\*.*" 0 done
  IfFileExists "$INSTDIR\opencode-piggy-install.json" done 0
  Abort
  done:
FunctionEnd

; 打开现有文件但不写入，确认安装目录的桌宠和桥运行时已释放。
!macro CheckExecutable PATH
  ${If} ${FileExists} "${PATH}"
    System::Call 'kernel32::CreateFileW(w "${PATH}", i 0x40000000, i 7, p 0, i 3, i 0, p 0) p .r0'
    ${If} $0 == -1
      MessageBox MB_ICONSTOP "请先退出小猪，并停止 OpenCode 后台服务，再安装或卸载。"
      SetErrorLevel 1
      Abort
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
!macroend

Section "安装"
  ; 静默安装同样拒绝占用的未知目录。
  IfFileExists "$INSTDIR\*.*" 0 available
  IfFileExists "$INSTDIR\opencode-piggy-install.json" available 0
  MessageBox MB_ICONSTOP "目标目录不是 OpenCode Piggy 安装目录，请选择空目录。"
  SetErrorLevel 1
  Abort
  available:
  !insertmacro CheckExecutable "$INSTDIR\OpenCodePiggy.exe"
  !insertmacro CheckExecutable "$INSTDIR\resources\bridge-node\node.exe"
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*"
  nsExec::ExecToLog '"$INSTDIR\resources\bridge-node\node.exe" "$INSTDIR\resources\app\scripts\install-opencode.mjs" --global "--node-executable=$INSTDIR\resources\bridge-node\node.exe"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "插件启用失败，请查看安装详情。不会覆盖未托管的插件入口。"
    SetErrorLevel 1
    Abort
  ${EndIf}
  CreateDirectory "$SMPROGRAMS\OpenCode Piggy"
  CreateShortCut "$SMPROGRAMS\OpenCode Piggy\OpenCode Piggy.lnk" "$INSTDIR\OpenCodePiggy.exe" "" "$INSTDIR\icon.ico"
  CreateShortCut "$DESKTOP\OpenCode Piggy.lnk" "$INSTDIR\OpenCodePiggy.exe" "" "$INSTDIR\icon.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\OpenCode Piggy\卸载.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\OpenCodePiggy" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "OpenCode Piggy"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${GAME_VERSION} / ${COMPAT_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  IfFileExists "$INSTDIR\opencode-piggy-install.json" owned 0
  SetErrorLevel 1
  Abort
  owned:
  !insertmacro CheckExecutable "$INSTDIR\OpenCodePiggy.exe"
  !insertmacro CheckExecutable "$INSTDIR\resources\bridge-node\node.exe"
  nsExec::ExecToLog '"$INSTDIR\resources\bridge-node\node.exe" "$INSTDIR\resources\app\scripts\install-opencode.mjs" --global --uninstall --owned-only'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "插件停用失败，请查看卸载详情。"
    SetErrorLevel 1
    Abort
  ${EndIf}
  Delete "$DESKTOP\OpenCode Piggy.lnk"
  RMDir /r "$SMPROGRAMS\OpenCode Piggy"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\OpenCodePiggy"
  RMDir /r "$INSTDIR"
  ; 游戏存档、桥队列及其他 OpenCode 配置不在安装目录，不删除。
SectionEnd
