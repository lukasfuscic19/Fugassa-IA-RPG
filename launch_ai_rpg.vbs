Option Explicit

Dim shell, fso, projectDir, psFile, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
psFile = projectDir & "\launch_ai_rpg.ps1"

shell.CurrentDirectory = projectDir
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File """ & psFile & """"
shell.Run cmd, 0, False
