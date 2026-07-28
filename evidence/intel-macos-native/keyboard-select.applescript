on safeField(valueText)
  set cleaned to valueText as text
  set AppleScript's text item delimiters to {tab, linefeed, return}
  set parts to text items of cleaned
  set AppleScript's text item delimiters to " "
  set cleaned to parts as text
  set AppleScript's text item delimiters to ""
  return cleaned
end safeField

on run argv
  if (count of argv) < 2 then error "Usage: keyboard-select.applescript <target accessible name fragment> <enter|space> [max tabs]"
  set targetFragment to item 1 of argv
  set activationName to item 2 of argv
  set maximumTabs to 80
  if (count of argv) is greater than or equal to 3 then set maximumTabs to (item 3 of argv) as integer
  if activationName is not "enter" and activationName is not "space" then error "Activation must be enter or space."

  tell application "System Events"
    if UI elements enabled is false then error "Accessibility permission is not enabled for native keyboard evidence."
    set matches to every process whose bundle identifier is "com.openai.codex"
    if (count of matches) is not 1 then error "Expected exactly one running ChatGPT process."
    set appProcess to item 1 of matches
    set frontmost of appProcess to true
    set appPid to unix id of appProcess
  end tell

  set evidenceLog to "preflight" & tab & "pid=" & appPid & tab & "input-policy=Tab,Shift+Tab,Space,Enter" & linefeed
  repeat with stepNumber from 1 to maximumTabs
    tell application "System Events"
      key code 48
      delay 0.12
      set focusedElement to value of attribute "AXFocusedUIElement" of appProcess
      set focusedRole to "unknown"
      set focusedName to ""
      set focusedDescription to ""
      try
        set focusedRole to role of focusedElement
      end try
      try
        set focusedName to name of focusedElement
      end try
      try
        set focusedDescription to description of focusedElement
      end try
    end tell
    set evidenceLog to evidenceLog & "Tab" & tab & "step=" & stepNumber & tab & (my safeField(focusedRole)) & tab & (my safeField(focusedName)) & tab & (my safeField(focusedDescription)) & linefeed
    if focusedName contains targetFragment or focusedDescription contains targetFragment then
      tell application "System Events"
        if activationName is "enter" then
          key code 36
        else
          key code 49
        end if
        delay 0.2
      end tell
      set evidenceLog to evidenceLog & (activationName) & tab & "activated=" & (my safeField(targetFragment)) & linefeed
      return evidenceLog
    end if
  end repeat
  error "Target control was not reached within the allowed Tab steps; no activation key was sent."
end run
