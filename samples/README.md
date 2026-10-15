Sample files used by the tests. Copy them from the old project as files only (no source code).

parser/   one folder per case: `subject.txt`, `body.txt`, `expected.json`  (the 26 parser cases)
engine/   one folder per case: `messages.json` (ordered raw messages), `expected-alarms.json`  (the 31 engine cases)
gmail/    recorded Gmail API JSON responses used by the mocked client in G-T06 tests:
          `history-list.json`, `history-list-404.json`, `messages-list.json`, `message-get-*.json`, `attachment-get.json`
hourly/   at least one real `*.rar`, one `*.xlsx`, `reference-output.json`, `golden-export.xlsx`, and a 40 MB RAR for the memory test
export/   `seed-alarms.json` + `golden.xlsx` for the alarms export test
seed/     default classification rules (`rules.json`) and any seed CSV

Rules: tests read from here and never write here; a failing test is fixed in code, not by editing a sample.
