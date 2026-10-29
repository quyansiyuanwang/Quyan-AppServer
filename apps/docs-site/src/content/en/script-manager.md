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
- Bulk selection controls on desktop; mobile runs scripts individually.

### Execution actions

- Run selected scripts, terminate all scripts, and clear results on desktop.
- Stop an individual running script on desktop or mobile.
- Per-script run, edit, history, and delete actions.

### Results area

- Live execution output.
- History or past-result access.

## Common actions

1. Acknowledge the security warning.
2. On desktop, select one or more scripts to run together, or run one individually. On mobile, use the run button for each script.
3. Run only the scripts you trust and understand.
4. Monitor live output and stop scripts if they behave unexpectedly.
5. Review history when comparing repeated runs.

## Where scripts come from

Users with the appropriate permissions can write and save their own scripts. Before running, acknowledge the safety notice and confirm execution. The page asks for another confirmation when it detects certain common network APIs, but that detection cannot identify every risk.

## Wait for asynchronous work

Top-level script code can use `await`. Wait for any asynchronous work that must finish: the Worker is terminated after the script completes, so an unawaited timer or other background callback may not run. For example:

```js
await new Promise((resolve) => setTimeout(resolve, 1000))
console.log('Wait complete')
```

Output includes `console.log`, `console.warn`, and `console.error` messages. Calling `console.error` alone does not mark the execution as failed; throw an exception when execution should stop and be marked as failed. Check both the output and execution status.

## Permission requirements

| Action              | Required permission |
| ------------------- | ------------------- |
| View scripts        | `SCRIPT_READ`       |
| Create/edit scripts | `SCRIPT_CREATE`     |
| Delete scripts      | `SCRIPT_DELETE`     |

## Notes

- Scripts execute in a Web Worker in your current browser and may make network requests; they cannot directly manipulate the page DOM. Review the code and request destinations first, avoid scripts of unknown origin, and do not output credentials or sensitive data.
- On desktop, **Select all** selects the entire script list, including scripts on other pages. Bulk execution starts the selected scripts concurrently; check the selection and possible side effects first.
- Leaving the script manager terminates scripts that are still running. Network requests already sent and other external actions may not be reversible.
- After a run finishes, the page attempts to save a code snapshot and output as history. History may be missing if saving fails, the worker errors, or the run is manually terminated. Clearing results terminates active scripts and clears the current page results, but does not delete saved history.

## Related pages

- [Debug]({{DOCS_BASE_URL}}/en/debug-tools)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
