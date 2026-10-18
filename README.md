# Pimcore Command Control Center

Run Symfony console commands and PHP scripts from Pimcore Studio, or schedule them to run without an open browser.

- Search all registered console commands and inspect their arguments/options.
- Stream stdout/stderr and display the exit code.
- Paste PHP directly for `pimcore:run-script`.
- Schedule one-time, hourly, daily or weekly executions.
- Edit, enable/disable/delete plans and inspect the latest output and status.
- Persistent run history with input/output snapshots, filters and pagination.
- Reusable command templates with input fields and opt-in read-only object previews.
- Multi-step workflows that run commands in the background and stop at the first failure.
- Schedule a workflow as a fixed snapshot, with per-step progress in the run history.
- Administrator access and CSRF protection on mutations.

## Security disclaimer

**Use this bundle at your own risk, especially in production environments.** It allows administrators to
execute console commands and arbitrary PHP code in your application's environment. Incorrectly configured
administrator accounts or permissions, compromised accounts, and unsafe commands or scripts can pose
significant risks to the entire system, including data loss, disclosure of sensitive information and service
disruption. Grant administrator access only to trusted, qualified users, review commands and scripts before
execution, and maintain tested backups before using the bundle in production.

![Pimcore Studio Command Control Center with inline PHP execution](docs/img/studio-command-control-center.png)

## Tips

See [Tips and script examples](docs/tips.md), including
[sending a Studio notification to all active users](docs/tips.md#notify-all-active-users).

See [Run history, templates and preview providers](docs/history-and-templates.md) for the new tabs,
storage details and a preview-provider example.

See [Workflows](docs/workflows.md) for sequential background runs, queued execution, snapshots and
recovery after a worker interruption.

## Languages

The interface follows the Studio user language and includes English and German translations for tabs,
forms, actions, status labels and application messages. Dates follow the selected UI language.
Command descriptions/output and user-supplied PHP code are not translated.

## Compatibility

| Platform | Pimcore core | Studio UI / Backend | PHP |
| --- | --- | --- | --- |
| 2025.4 LTS | `^12.3` | `^2025.4` | 8.3 / 8.4, as supported by your Pimcore release |
| 2026.x | `^2026.1` | `^2026.1` | 8.4 / 8.5, as supported by your Pimcore release |

The PHP code supports Symfony 6.4 and 7.x, including Symfony 8.x CSRF tokens in newer host projects. CI tests the PHP dependencies and frontend SDKs separately.
Studio 2025.4.0 and 2026.3.2 are the frontend compatibility targets. A full application smoke test is also
performed in the development project on Pimcore/Studio 2026.3.2; CI does not provision an entire Pimcore database.

Pimcore Platform 2025.4 uses core **12.3**, rather than a core version named 2025.4.
The compiled frontend ships with every tagged release (and therefore with Composer distributions), so installing the bundle
in another project does not require Node.js. It is built by CI on the release tag; the default branch keeps only sources.

## Install

Until the package is submitted to Packagist, add this GitHub repository to the host project:

```sh
composer config repositories.command-center vcs https://github.com/Waaatza/pimcore-command-center-bundle
composer require watza/command-center-bundle:^0.4
```

Register the bundle in `config/bundles.php` if your installation did not register it automatically:

```php
Watza\CommandCenterBundle\PimcoreCommandCenterBundle::class => ['all' => true],
```

Then install assets and clear the application cache:

```sh
php bin/console assets:install --symlink public
php bin/console cache:clear
```

Open **System → Command Center** in Studio as a Pimcore administrator.
Routes are loaded through Pimcore's bundle routing; the frontend uses the configured Studio API prefix.
No database migration is needed.

## Direct execution

Choose a command. Arguments/options are a JSON array, with one string per CLI token:

```json
["some-argument", "--limit=10"]
```

Use `[]` for no arguments. Commands are executed without a shell and without interactive prompts,
with a five-minute process timeout. Environment, ANSI output and interaction flags are controlled by the server.

For `pimcore:run-script`, paste code in the PHP field, with or without the opening `<?php` tag:

```php
<?php
$listing = new \Pimcore\Model\DataObject\Listing();
$listing->setUnpublished(true);
$listing->setObjectTypes([
    \Pimcore\Model\DataObject::OBJECT_TYPE_OBJECT,
    \Pimcore\Model\DataObject::OBJECT_TYPE_VARIANT,
]);
echo 'Objects: ' . $listing->getTotalCount() . PHP_EOL;
```

The PHP script runs in an initialized Pimcore environment. Its temporary file is deleted on success or failure.
Inline scripts accept `--dry-run`, verbose and quiet options; do not supply a script filename.

## Scheduled executions

1. Select/configure the command in the **Direct execution** tab.
2. Switch to the **Scheduled executions** tab.
3. Enter a name, first execution and recurrence; save the plan.

Each plan stores a separate copy of the arguments and PHP code. Changing the direct-execution form does not
change saved plans. Use **Edit** in the schedule list to update a saved plan's name, command,
arguments, PHP code, next execution, recurrence, enabled state and failure-notification settings.
The ID, creation metadata and latest execution result are preserved. Running schedules cannot be edited.
If another administrator or the worker changes the plan after the editor opens, saving is rejected with a
conflict; cancel and reopen the editor to load the latest version. Polling does not overwrite unsaved edits.

Dates are entered/displayed in the browser timezone. Daily/weekly recurrence preserves
that timezone across daylight-saving transitions.

Keep the following worker running in the host application's environment:

```sh
php bin/console messenger:consume scheduler_command_center --memory-limit=250M --time-limit=3600
```

Use Supervisor, systemd or your container orchestrator to restart it automatically.
For Docker Compose, reuse your application's PHP image, environment and project volume, for example:

```yaml
services:
  command-center-worker:
    image: your-project-php-image
    working_dir: /var/www/html
    command: ["php", "bin/console", "messenger:consume", "scheduler_command_center", "--memory-limit=250M", "--time-limit=3600"]
    restart: unless-stopped
    stop_grace_period: 360s
    volumes:
      - .:/var/www/html
```

The worker must be able to connect to your application's database and other services.
Use the same filesystem user/permissions as the web application for the schedule directory.

The Symfony scheduler checks every ten seconds and runs jobs serially. Long jobs can delay later jobs.
Overdue recurrences are coalesced into one execution. The tab shows the latest worker heartbeat;
its absence means no worker has checked the plans yet.

Plans and latest results are stored outside the public directory in `var/command-center/<environment>/`.
Preserve/share this directory between web and worker and across deployments, and include it in backups.
Each job retains at most 1 MB of output, with up to 50 stored plans. Output is refreshed while a scheduled job
runs. The schedule details show the latest result; the **Run history** tab keeps all new executions independently.

Completed one-time plans can be scheduled again with **Bearbeiten**: choose a future execution and set the status to active. Disabling a running recurring plan prevents
future runs and lets the current run finish. Running plans cannot be deleted.
A filesystem lock prevents concurrent workers from claiming the same job. After an unexpected worker stop,
the next worker marks an unfinished job interrupted and disables its schedule. Inspect its effects before
rescheduling; jobs are not automatically retried because they may already have modified data.

## Workflows

The **Workflows** tab chains several commands into one background run. A workflow holds a label, an
optional description and 1–20 ordered steps. Every step has its own label, a command from the catalog,
a JSON argument array and, for `pimcore:run-script`, inline PHP code. **From direct execution** appends
the command currently configured in the **Direct execution** tab. Up to 100 workflows can be stored.

Steps run in order. The first failing step stops the workflow: its exit code and error become the
result of the run, later steps are marked as skipped and are never executed. Each step is also recorded
as its own history entry linked to the workflow run, so a failed step can be inspected on its own.
Arguments, PHP code and protected global options are validated exactly like direct execution, once
when the workflow is saved and again before every step.

**Run now** only queues the run; the browser never blocks. The worker picks it up within one scheduler
interval (ten seconds) once no schedule is due, and the run continues after Studio is closed. Queued
runs store a snapshot of the definition: editing or deleting the workflow does not change a run that
is already queued, and queueing fails with a conflict if the definition changed after the run was
requested. The **Run history** tab shows the queued run and its steps with the trigger *Workflow*;
scheduled workflow runs appear as *Scheduled* runs of the schedule.

**Schedule workflow** creates an ordinary schedule that stores a fixed copy of all steps. The schedule's
command, argument and PHP fields are read-only afterwards; to use changed steps, save the workflow and
create a new schedule from it. Scheduled workflow runs use the schedule's failure notifications and show
their step progress in the schedule details.

Workflows share the worker's single runner lock with schedules: due schedules are claimed first and
everything runs serially, so a long workflow delays later plans and a long plan delays queued workflows.

If the worker stops in the middle of a workflow, the next tick marks the run and its active step as
interrupted, marks the remaining steps as skipped and never replays the run automatically, because
steps may already have changed data. Inspect the step history before running the workflow again.

Definitions are stored in `var/command-center/<environment>/workflows/catalog.json` and pending runs in
`workflow-queue/jobs.json`, next to schedules, templates and history, with the same requirements:
shared storage for web and worker, no public access, and inclusion in backups. See
[Workflows](docs/workflows.md) for the full behaviour.

## Development

```sh
composer install
composer test
cd assets
npm ci
npm run check-translations
npm run check-types
npm run build
```

The default branch contains sources only; `public/build/` is generated and is not committed.
To release a version, commit the sources (including a version bump in `assets/package.json` and
`assets/package-lock.json`, and the README's version constraint), then tag and push the tag:

```sh
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main vX.Y.Z
```

The `Release Build` workflow then installs the frontend dependencies, runs the build, commits the
generated `public/build/` into the tag, updates the tag and creates the GitHub release with the
generated release notes. A tag push alone therefore produces a complete, installable release;
no local build commit is needed.

For a local path installation in a host project, run the PHP tests against its dependencies:

```sh
COMMAND_CENTER_AUTOLOAD=/path/to/project/vendor/autoload.php php tests/CommandCenter/smoke.php
COMMAND_CENTER_AUTOLOAD=/path/to/project/vendor/autoload.php php tests/CommandCenter/schedules.php
```

The opt-in worker integration check creates a harmless, temporary scheduled PHP script and removes only its
own plan afterwards. Run it from a Git checkout or local path installation inside a configured host project with the worker running:

```sh
COMMAND_CENTER_AUTOLOAD=/path/to/project/vendor/autoload.php php tests/CommandCenter/worker-integration.php --live-worker
```

## Failure notifications

Choose active Pimcore users and **E-Mail**, **Studio-Benachrichtigung**, or both when creating a schedule.
For an existing schedule, open **Details** and save its notification settings. Changes apply to subsequent runs;
leave recipients and channels empty to disable alerts. Existing schedules keep notifications disabled by default.

Failed runs (nonzero exit codes, exceptions and timeouts) and worker-interrupted runs trigger alerts.
Successful runs do not. Each alert includes the plan, command, execution status and timestamps. PHP source,
arguments and command output are not included; inspect the full output in the Command Center.

Email uses Pimcore's existing mail configuration, including its sender address and transport. Recipients need
a valid email address. Studio recipients need the `notifications` permission. Users are checked again at send
time, so deleted/inactive users and revoked permissions are handled as delivery failures.

Delivery results appear with the latest run's details. A failed mail/notification delivery does not rerun the
command or prevent other recipients/channels from being processed. Deliveries are attempted once; there is
no automatic retry. A worker crash during delivery may leave an alert unsent; command execution is never
replayed to send an alert.

## Inspiration disclaimer

This project was inspired by the [Job Manager available in the Pimcore Store](https://store.pimcore.com/shop/job-manager-213).
It is an independent implementation and is not affiliated with or endorsed by the Job Manager's authors.

MIT licensed. Pimcore and its Studio SDK retain their own licenses.
