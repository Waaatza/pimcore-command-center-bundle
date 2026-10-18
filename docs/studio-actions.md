# Studio action buttons

Studio actions expose an administrator-approved command template or Command Center workflow as a button.
Administrators configure them under **Command Center → Studio actions**. New actions are disabled and have
no editor grants. The Command Center itself, command definitions, history browser and terminal remain
administrator-only.

![Studio actions](docs/img/studio-actions.png)

## Configure a button

1. Create a template or workflow first. Define any input fields it needs.
2. Create a Studio action, choose that target, and give the button a label and select an icon with the native
   Studio icon picker. Built-in icons and custom root-relative paths or HTTP(S) URLs are supported.
   Clearing the selection restores the default `play` icon. Set its order and one or more placements.
3. Select individual active users and/or existing Pimcore roles. Grants are combined: either a selected user
   or one of their roles is sufficient. Administrators have access without an explicit grant.
4. Optionally restrict object buttons to specific classes. An empty class selection allows all object classes.
5. Choose the required element permission: **Edit** by default, or **Read** for an appropriate checking action.
6. Configure input bindings, confirmation and output access, then enable and save the action.

Global actions appear as individual icon buttons with tooltips in the left Studio rail. Object, asset and
document actions appear as labelled buttons in their editor toolbars. Missing grants, insufficient element
permissions, a disabled action or a missing target hide the button. Changes refresh immediately in the
current Studio window and on the next focus event in other windows. No Studio core files are patched.

## Bind inputs

Each target field has one source:

- **User input**: an editable field, using the target field's default and validation rules.
- **Fixed value**: administrator-defined data; editors cannot change it and do not receive its value in the form.
- **Element ID**, **Element path**, **Element type**: values resolved on the server from the current editor.
  These bindings are fixed, displayed for confirmation, and cannot be overwritten by a submitted field.

The browser submits only the element type and ID. The backend loads the element, checks its permissions
and class, and obtains its actual path. Unknown fields, forged paths and attempts to override bound values
are rejected. A global placement cannot be combined with element bindings; create a separate global action
for the same target if needed.

Buttons open a confirmation/input dialog by default. Where a template preview provider exists, the dialog
requires a preview for the current inputs before execution. Changing inputs invalidates that preview.
**Start without confirmation** is an explicit administrator option; all mandatory values must be supplied
by bindings or valid defaults. Such a button starts immediately, including when a preview provider exists.

## Workflow inputs

Workflows now support the same `string`, `integer` and `choice` fields as templates. Use placeholders such
as `{{objectId}}` in the CLI argument array of any step:

```json
["--object-id={{objectId}}"]
```

Resolved values are also available to every step as JSON in `COMMAND_CENTER_INPUTS`. For an inline PHP step:

```php
$inputs = json_decode(getenv('COMMAND_CENTER_INPUTS'), true, 512, JSON_THROW_ON_ERROR);
$objectId = (int) $inputs['objectId'];
```

PHP source is never interpolated. Inputs are data; each custom command/script remains responsible for the
meaning and safety of the operation it performs. Workflow Run now and Schedule also ask for these values.
Queued jobs and schedules keep resolved argument/input snapshots; later workflow edits do not change them.
Existing workflows without fields retain their literal arguments and need no migration.

## Results and access

A template runs through the existing streaming execution path; a workflow runs through the existing
background worker. Closing a template's active dialog aborts its HTTP stream; a queued workflow continues
in the worker after its dialog closes. Its full run remains available to administrators in run history.

Editors see only their own action run's status, step labels/statuses and exit code. Full command/PHP source,
input snapshots, raw exception details and other users' history are never returned by the action-result API.
**Allow editors to see their output** must be explicitly enabled on the button. Output remains private to
the starting user, and access still requires the current action grant and element permission. Previously
restricted runs are not retroactively released by enabling output. Administrators can use ordinary history.

The server checks the login, grants, context, CSRF and action/target revisions before preparation, preview
and execution. Changes while a dialog is open require reloading it. Queued workflows check the starting
user's current active state, grants, element rights and action revision again before running; removed or
changed approval fails the queued run without executing a step. Target definition changes do not alter the
already approved workflow snapshot.

**This delegates the stored command, not a sandbox.** It executes with the application's OS/database
permissions. Element permission checks protect the selected context, but cannot restrict arbitrary custom
PHP/console code to that element. Administrators must review the entire stored action, its editable fields,
its side effects and its output before granting it to editors.

## API and storage

All routes use the configured Studio API prefix, followed by `/command-center/actions/`:

- Admin-only: `GET admin`, `POST save`, `POST delete`.
- Logged-in users: `POST available`, `POST prepare`, `POST preview`, `POST run`, `POST result`.

Editor routes perform their own grant/context checks. They accept references, revisions, context IDs and
approved input values, never user-supplied command names, PHP source or workflow steps. Runs use the normal
history source (`template` or `workflow`) with additional action/actor metadata. Error responses and the UI
are deliberately generic; administrators can inspect full run details through their existing history view.

Action definitions live in `var/command-center/<environment>/studio-actions/catalog.json`, using the
existing private atomic JSON storage and revision checks. Preserve/share and back up this directory with
the rest of Command Center storage. At most 100 actions can be configured; actions start disabled.

[Back to README](../README.md)
