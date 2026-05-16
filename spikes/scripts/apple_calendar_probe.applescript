set startOfDay to current date
set time of startOfDay to 0
set endOfDay to startOfDay + (24 * 60 * 60)
set outputLines to {}

tell application "Calendar"
  repeat with cal in calendars
    set eventList to (events of cal whose start date ≥ startOfDay and start date < endOfDay)
    repeat with evt in eventList
      set eventTitle to summary of evt
      set eventStart to start date of evt
      set eventEnd to end date of evt
      set end of outputLines to ((name of cal) & " | " & eventTitle & " | " & (eventStart as text) & " | " & (eventEnd as text))
    end repeat
  end repeat
end tell

set AppleScript's text item delimiters to linefeed
return outputLines as text
