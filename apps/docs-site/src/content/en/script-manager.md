# Script manager

Use this page to write, save, and run your own JavaScript scripts and inspect the results.

## Create or edit a script

After signing in, users with the appropriate permissions can manage their own scripts.

1. Select the create button. Enter a script name and JavaScript code, and optionally add a description. Names allow up to 100 characters and descriptions up to 500.
2. Select **Save**, then find the script in the list after saving succeeds. Saving updates the script without executing its code.
3. To change an existing script, select its edit button, make your changes, and save.
4. To delete a script, select delete and confirm. Save any code you need before deleting it.

## Run and stop scripts

1. Read and acknowledge the safety notice. Run only scripts you trust and understand.
2. Select a script's run button. On desktop, you can also select multiple scripts and run the selection. On mobile, use each script's run button.
3. Confirm execution in the dialog. The page asks for another confirmation when it detects certain common network APIs, but that detection cannot identify every risk.
4. Check live output and status in the results area, and stop individual running scripts when needed. Desktop also provides actions to terminate all scripts or clear the current results.

Each run executes the code saved when it starts. Editing a script does not update an execution already running; save and run again to use the new code.

## View results and history

The results area shows executions and output from the current page session, with running, completed, error, and terminated states. Select a script's history button to view saved execution times, durations, and output. Hover over a long output preview to read its full content.

Current results and saved history have different scopes: an execution appearing in the results does not mean its history has been saved. History may be missing if saving fails, the worker errors, or the run is manually terminated. Clearing results terminates active scripts and clears the current page results, but does not delete saved history.

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
- After a run finishes, the page attempts to save a code snapshot and output on the server. Keep credentials and unnecessary sensitive information out of both script code and output.

## Related pages

- [Debug]({{DOCS_BASE_URL}}/en/debug-tools)
- [System logs]({{DOCS_BASE_URL}}/en/system-logs)
