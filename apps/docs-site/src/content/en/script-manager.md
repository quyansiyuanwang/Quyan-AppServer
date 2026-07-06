# Script manager

Use this page to run approved user scripts and inspect execution results.

## Page purpose

- Maintain saved scripts.
- Run selected scripts safely.
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

Scripts are not provided by admins — any user can write and save their own scripts here. There is no platform-curated script library or pre-approval workflow; "approved" in this context means the scripts you personally saved and chose to keep, not scripts vetted by an administrator.

## Permission requirements

| Action              | Required permission |
| ------------------- | ------------------- |
| View scripts        | `SCRIPT_READ`       |
| Create/edit scripts | `SCRIPT_CREATE`     |
| Delete scripts      | `SCRIPT_DELETE`     |

## Notes

- Script execution should be limited to content you wrote yourself or fully understand — since scripts are user-authored, "trusted content" means content you trust, not content reviewed by the platform.
- Bulk execution is convenient but raises the risk of accidental side effects.
- Results on this page are often useful when paired with logs or balance-impact checks.

## Related pages

- `debug-tools`
- `system-logs`
