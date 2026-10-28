# Script manager

Use this page to write, save, and run your own JavaScript scripts and inspect the results.

## Page purpose

- Maintain saved scripts.
- Run selected scripts.
- Review output and history.
- Stop active scripts when needed.

## What you will see

### Script list

- Script names and selection state.
- Security warning and acknowledgement checkbox.
- Bulk select controls.

### Execution actions

- Run selected scripts.
- Terminate all scripts.
- Clear results.
- Per-script run, edit, history, and delete actions.

### Results area

- Live execution output.
- History or past-result access.

## Common actions

1. Acknowledge the security warning.
2. Select one or more scripts.
3. Run only the scripts you trust and understand.
4. Monitor live output and stop scripts if they behave unexpectedly.
5. Review history when comparing repeated runs.

## Where scripts come from

Users with the appropriate permissions can write and save their own scripts. Before running, acknowledge the safety notice and confirm execution. The page asks for another confirmation when it detects certain common network APIs, but that detection cannot identify every risk.

## Permission requirements

| Action              | Required permission |
| ------------------- | ------------------- |
| View scripts        | `SCRIPT_READ`       |
| Create/edit scripts | `SCRIPT_CREATE`     |
| Delete scripts      | `SCRIPT_DELETE`     |

## Notes

- Scripts execute in a Web Worker in your current browser and may make network requests; they cannot directly manipulate the page DOM. Review the code and request destinations first, avoid scripts of unknown origin, and do not output credentials or sensitive data.
- Bulk execution is convenient but raises the risk of accidental side effects.
- After a run finishes, the page attempts to save a code snapshot and output as history. History may be missing if saving fails, the worker errors, or the run is manually terminated. Clearing results terminates active scripts and clears the current page results, but does not delete saved history.

## Related pages

- [Debug]({{DOCS_BASE_URL}}/en/debug-tools)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
