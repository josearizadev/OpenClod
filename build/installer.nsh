; Ganchos del instalador NSIS (electron-builder incluye este archivo automáticamente).

!include WordFunc.nsh

; Al abrir el instalador con OpenClod ya instalado, compara versiones y pregunta
; antes de seguir. En modo silencioso (/S) o en la instancia elevada (UAC) no pregunta.
!macro customInit
  ${IfNot} ${Silent}
  ${AndIfNot} ${UAC_IsInnerInstance}
    Push $0
    Push $1
    ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${If} $0 == ""
      ReadRegStr $0 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${EndIf}
    ${If} $0 != ""
      ; $1: 0 = misma versión, 1 = la instalada es más reciente, 2 = esta es más reciente
      ${VersionCompare} "$0" "${VERSION}" $1
      ${If} $1 == 2
        MessageBox MB_YESNO|MB_ICONQUESTION "${PRODUCT_NAME} $0 ya está instalado.$\r$\n$\r$\n¿Actualizar a la versión ${VERSION}?" IDYES +2
        Quit
      ${ElseIf} $1 == 0
        MessageBox MB_YESNO|MB_ICONQUESTION "${PRODUCT_NAME} ${VERSION} ya está instalado.$\r$\n$\r$\n¿Reinstalarlo?" IDYES +2
        Quit
      ${Else}
        MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Ya tienes instalada una versión más reciente de ${PRODUCT_NAME} ($0).$\r$\n$\r$\n¿Instalar igualmente la versión ${VERSION}?" IDYES +2
        Quit
      ${EndIf}
    ${EndIf}
    Pop $1
    Pop $0
  ${EndIf}
!macroend

; Al desinstalar (no en una actualización) quita «Abrir en OpenClod» del menú contextual del
; Explorador, que la app añade en HKCU si se activa en Ajustes.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenClod"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenClod"
  ${EndIf}
!macroend
