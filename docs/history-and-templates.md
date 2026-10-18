# Run history and command templates

## Persistent run history

The **Run history** tab keeps every new execution started by the Command Center: direct commands,
inline PHP scripts, scheduled jobs, templates and workflow runs. It stores start/end timestamps, duration, exit code,
status, trigger, the initiating Studio user for direct/template runs, and a snapshot of the command,
arguments, PHP source and combined stdout/stderr. Scheduled runs retain the schedule ID and label;
template runs retain the template ID and label; workflow runs retain the workflow ID and label.
Editing or deleting the source does not change these records.

Workflow runs are recorded twice: once as the run of the workflow itself, and once per executed step,
each step keeping its own input and output plus the parent run ID, step index and step label. Opening
the details of a step offers **Open workflow run** to move back to the combined run; see
[Workflows](workflows.md).

Filter by command/label, status (including *Queued*) or trigger (including *Workflow*). The list is paginated (25 runs per page); details show the
saved input and output. An active history tab refreshes every five seconds. The server updates output
approximately once a second when output arrives and writes the final result when execution ends.
Only the last 1 MB of output is retained per run; truncated output is explicitly marked.

History starts when this version is installed. Existing latest schedule results are preserved in their
schedule, but cannot be reconstructed into a complete history. Runs from an external terminal are not recorded.
After an abrupt process/worker termination, an unfinished record becomes **Interrupted** when read after
ten minutes. Its actual finish time and exit code remain unknown. Commands still have a five-minute timeout.
Disconnecting a direct/template run stops it when the server detects the disconnect; the history remains.

Records are private JSON files in `var/command-center/<environment>/history/`, with compact listing records
in `history-summary/`. No database migration is required. Keep the entire `var/command-center` directory
on persistent, shared storage for web and worker, with filesystem permissions restricted to the application
user; back it up together with schedules and templates. History has no automatic expiry. Monitor disk usage
and apply your own retention policy if required, removing matching IDs from both history directories only
for completed runs. Arguments, source code and output can contain application data or secrets, so treat
backups and exports accordingly. CSRF tokens are never persisted in history.

The filesystem implementation is intended for a single application deployment with shared local storage;
all workers and web instances must see the same files and support atomic rename/flock semantics.

## Reusable templates

In **Templates**, create a template or use **From direct execution** to copy a configured command.
Enter a label, description and JSON argument tokens. Add input fields using **Add field**:

- **Text** for paths, names or other strings.
- **Integer** for integer values.
- **Choice** for a fixed list of values (one per line).

Each field has a unique placeholder name, label, optional default and required setting. For example:

```json
["{{folder}}", "--limit={{limit}}", "--mode={{mode}}"]
```

Add `folder` (Text), `limit` (Integer, default `10`) and `mode` (Choice, e.g. `update` / `check`).
Selecting the template renders ordinary input fields; users do not have to edit JSON to run it.
Values are substituted into individual argument tokens and are never interpreted by a shell.
A positional value cannot start with `-`; write options as `--name={{value}}` in a single token.
The server rejects unknown fields, invalid types, undefined placeholders and protected global options.
Templates do not support inline PHP source. For PHP scripts, use direct execution or schedules.

Templates are stored in `var/command-center/<environment>/templates/catalog.json`. Changes are atomic and
revision-checked: stale edits, deletions, previews and executions return a conflict instead of using a
silently changed definition. Deleting a template preserves its historical runs. All template APIs and the
interface require administrator access, just like direct execution; templates do not delegate CLI privileges
to non-administrator accounts.

## Read-only object previews

A template shows **Preview affected objects** when its command has a registered preview provider. For these
templates, first preview the inputs, inspect the count and sample changes, then execute. Changing the
inputs clears the preview. The preview is bound to the selected template ID, revision and input values.
Reloading a changed template requires a fresh preview; delayed responses for an older revision cannot
enable execution or appear as current results. While a command runs, its previous preview is hidden.
After the execution stream finishes, a fresh preview is loaded automatically, including after a nonzero exit code so partial changes
are reflected. If execution or preview loading fails, the old preview remains hidden. Commands without a provider show that preview is unavailable
and can still be run normally. A preview is advisory: objects may change before execution and commands must
re-evaluate their selection. It is not a transaction or a guarantee that every planned write will succeed.

The bundle never invokes an arbitrary command or PHP script to obtain a preview. Applications explicitly
implement `CommandPreviewProviderInterface` and return a `CommandPreviewResult`. Providers must only read data;
never call `save()`, `delete()`, execute the command, send messages or perform other side effects. Share the
selection/transformation logic with your command so the preview matches the real operation.

Commands execute in a separate CLI process. In long-running web workers, cached Pimcore object instances can
still contain values from before that execution. Preview providers must read the current data, for example
by loading listing IDs and resolving each object with `getById($id, ['force' => true])` through an injected
Pimcore data-object resolver. Creating a new listing alone does not bypass the object cache.

```php
namespace App\Service;

use Watza\CommandCenterBundle\Preview\CommandPreviewProviderInterface;
use Watza\CommandCenterBundle\Preview\CommandPreviewResult;

final readonly class RenamePreview implements CommandPreviewProviderInterface
{
    public function __construct(private RenamePlanner $planner) {}

    public function command(): string
    {
        return 'app:rename-objects';
    }

    public function preview(array $tokens): CommandPreviewResult
    {
        // Use exactly the same argument interpretation and read-only selection as the command.
        $count = 0;
        $samples = [];
        foreach ($this->planner->changes($tokens) as $change) {
            $count++;
            if (count($samples) < 20) {
                $samples[] = ['label' => $change->path, 'before' => $change->before, 'after' => $change->after];
            }
        }

        return new CommandPreviewResult($count, $samples);
    }
}
```

`RenamePlanner` above is your application's own read-only selection service, not a class shipped by this bundle.
Register the provider as an autoconfigured Symfony service; implementing the interface adds the
`command_center.preview_provider` tag automatically. If autoconfiguration is disabled, add the tag explicitly.
Use one provider per command. Return at most 20 samples and a non-negative total count. Output is rendered as
plain text. A provider may reject unsupported argument combinations with `BadRequestHttpException`.

```yaml
# config/services.yaml
services:
    App\Service\RenamePreview:
        autowire: true
        autoconfigure: true
```
