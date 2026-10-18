# Workflows

## Sequential background runs

The **Workflows** tab chains several commands into one run. **New workflow** opens an editor with a
label, a description and a list of steps. **From direct execution** appends the command configured in
the **Direct execution** tab to the step list. Steps can be added, removed and moved; each step has

- its own label (shown as the step title in the output and in history),
- a command selected from the registered console commands,
- a JSON array of argument tokens, one string per token, exactly like direct execution,
- inline PHP code for `pimcore:run-script` only.

Saving validates the whole workflow: a label is required, descriptions are limited to 2000 characters,
a workflow holds 1–20 steps, every step needs a label and a command, arguments must be strings
(at most 100 tokens per step) and the serialized steps must stay below 2 MB. Commands are checked
against the console catalog, and protected global options such as `--env` are rejected. Workflows are
edited with a revision: if another administrator changes or deletes the selected workflow after the
editor opened, saving, deleting or queueing it fails with a conflict instead of using the silently
changed definition.

**Delete workflow** removes only the definition. Queued runs, schedules and history keep the snapshot
they captured, so past executions remain readable after the definition is gone.

## Queued execution

**Run now** does not execute anything in the browser. It stores a snapshot of the definition in a queue
and answers with a new run in the status *Queued*; the view then polls the run every three seconds and
shows the combined output, the status of each step and, per step, its own output.

The run starts when the worker next processes the scheduler: the same
`messenger:consume scheduler_command_center` worker that executes schedules checks the queue every ten
seconds, after due schedules have been claimed. The run therefore continues when Studio is closed, and
it starts within one interval when no schedule is due. Workflows and schedules share one runner lock
and execute serially: a long workflow delays later plans, and a long plan delays queued workflows.

Steps run strictly in order. The first failing step stops the workflow: its exit code becomes the exit
code of the run, its error message becomes the run error, and all later steps change from *Pending* to
*Skipped* without being executed. A PHP exception inside a step fails that step in the same way.

## Scheduling a workflow

**Schedule workflow** creates a schedule that stores a fixed copy of all steps together with the first
step's command as the plan's execution. The command, argument and PHP fields of that plan are
read-only in the schedule editor, because the steps are stored inside the schedule: changing the
workflow afterwards does not change existing plans. To use changed steps, save the workflow and create
a new plan from it.

Scheduled workflow runs use the schedule's recurrence, timezone, enabled state and failure
notifications. Their history record carries the schedule ID and label as the trigger, and the schedule
details show the step progress of the latest run below the saved parameters.

## History and navigation

Every run is recorded independently in **Run history**:

- The workflow run itself has the trigger *Workflow* (queued runs) or *Scheduled* (plans), the command
  `workflow`, the combined output of all steps and the ordered step list with labels, statuses, exit
  codes and links to the step records.
- Every step is stored as its own history record with the trigger inherited from the workflow, the
  step label, the step index, the parent run ID and its own input and output snapshot.

Workflow runs have the status *Queued* before the worker picks them up; their start time is the
queueing time until execution begins. The history filter offers *Queued* as a status and *Workflow*
as a trigger. Opening the details of a step offers **Open workflow run** to jump back to the parent
run, and the workflow view offers **Step output** to inspect a single step. Schedule details embed
the same view for the latest run.

## Interruption and recovery

Workflows are never replayed automatically. If the worker stops in the middle of a run, the next tick
finds the queue entry in the status *Running*, marks the run as interrupted, marks the active step and
its step record as interrupted, marks all pending steps as skipped and drops the queue entry. The
remaining steps are not executed later, because a step may already have changed data. The same applies
to an unfinished scheduled workflow: the plan is disabled and its run interrupted before the failure
notification is sent.

An interrupted run therefore needs to be inspected like an interrupted schedule: check what the active
step did, then start the workflow again explicitly. Runs whose completion was never recorded become
*Interrupted* when they are read after ten minutes.

## Storage, limits and access

Definitions live in `var/command-center/<environment>/workflows/catalog.json`, pending runs in
`workflow-queue/jobs.json` and step records in the existing `history/` and `history-summary/`
directories. Keep the whole `var/command-center` directory on shared storage for web and worker, with
the same permissions and backup rules as schedules and history; the files are never exposed publicly.

At most 100 workflows and 100 queued runs are kept, each run retaining at most 1 MB of output, and
history has no automatic expiry. Every workflow API (listing, saving, deleting, queueing) and the tab
itself require Pimcore administrator access and a valid CSRF token; non-administrators cannot queue,
inspect or change workflow steps through those endpoints. Administrators may separately delegate a stored
workflow through [Studio action buttons](studio-actions.md), with explicit grants and server-bound inputs.

## Input fields

Workflows can define the same typed input fields as templates. Run now and Schedule ask for required
values; each step can use `{{fieldName}}` in CLI tokens. All resolved inputs are also JSON in
`COMMAND_CENTER_INPUTS`, including for inline PHP. PHP source is not interpolated. Values are validated
before a run is queued or a schedule is created, and stored with the resolved snapshot. Existing workflows
without fields keep their literal arguments unchanged. See [Studio actions](studio-actions.md#workflow-inputs).

[Back to README](../README.md)
