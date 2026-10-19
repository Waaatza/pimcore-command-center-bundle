<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Watza\CommandCenterBundle\Parameter\CommandRunParameters;

/** @internal */
final readonly class CommandScheduleRunner
{
    public function __construct(
        private CommandScheduleStore $store,
        private CommandCenterService $commands,
        private FailureNotifierInterface $notifier,
        private ?CommandWorkflowRunner $workflows = null,
        private ?CommandRunWorker $runs = null,
    )
    {
    }

    /** Execute one due job per tick. A separate lock prevents duplicate execution by concurrent workers. */
    public function tick(): void
    {
        $lock = fopen($this->store->directory() . '/runner.lock', 'c');
        if ($lock === false) {
            throw new \RuntimeException('Cannot open command runner lock.');
        }
        try {
            if (!flock($lock, LOCK_EX | LOCK_NB)) {
                return;
            }
            touch($this->store->directory() . '/heartbeat');
            $interrupted = [];
            $item = $this->claim(new \DateTimeImmutable(), $interrupted);
            foreach ($interrupted as $unfinished) {
                if (isset($unfinished['workflow'], $unfinished['lastRun']['historyId'])) {
                    $this->workflows?->interrupt($unfinished['lastRun']['historyId']);
                }
                $this->notifyFailure($unfinished);
            }
            if ($item === null) {
                $this->workflows?->tickQueued();
                $this->runs?->tickQueued();
                return;
            }
            $output = '';
            $exitCode = null;
            $error = null;
            $lastFlush = microtime(true);
            try {
                $parameters = new CommandRunParameters($item['command'], '', $item['tokens'], $item['phpCode']);
                $receive = function (array $event) use (
                    $item, &$output, &$exitCode, &$error, &$lastFlush,
                ): void {
                    if ($event['type'] === 'run') {
                        $this->saveResult($item['id'], ['historyId' => $event['id']]);
                    } elseif ($event['type'] === 'exit') {
                        $exitCode = $event['code'];
                    } else {
                        $output = substr($output . ($event['text'] ?? ''), -1000000);
                        if ($event['type'] === 'error') {
                            $error = $event['text'];
                        }
                    }
                    if (microtime(true) - $lastFlush >= 1) {
                        $this->saveResult($item['id'], ['output' => $output]);
                        $lastFlush = microtime(true);
                    }
                };
                $context = ['source' => 'scheduled', 'scheduleId' => $item['id'], 'scheduleLabel' => $item['label']];
                if (isset($item['workflow'])) {
                    if ($this->workflows === null) {
                        throw new \RuntimeException('Workflow runner is unavailable.');
                    }
                    $this->workflows->execute($item['workflow'], $receive, $context);
                } else {
                    $this->commands->execute($parameters, $receive, $context);
                }
            } catch (\Throwable $exception) {
                $error = $exception->getMessage();
                $output = substr($output . "\n" . $error, -1000000);
            }
            $result = [
                'status' => $error === null && $exitCode === 0 ? 'success' : 'failed',
                'finishedAt' => gmdate(DATE_ATOM),
                'exitCode' => $exitCode,
                'output' => $output,
            ];
            $this->saveResult($item['id'], $result);
            if ($result['status'] === 'failed') {
                $item['lastRun'] = array_replace($item['lastRun'], $result);
                $this->notifyFailure($item);
            }
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    private function claim(\DateTimeImmutable $now, array &$interrupted): ?array
    {
        return $this->store->update(static function (array &$items) use ($now, &$interrupted): ?array {
            // No other runner holds runner.lock: any leftover running job was interrupted.
            // Never retry it automatically, as it may already have caused side effects.
            foreach ($items as &$item) {
                if (($item['lastRun']['status'] ?? null) === 'running') {
                    $item['enabled'] = false;
                    $item['revision'] = ($item['revision'] ?? 0) + 1;
                    $item['lastRun']['status'] = 'interrupted';
                    $item['lastRun']['finishedAt'] = $now->format(DATE_ATOM);
                    $item['lastRun']['output'] .= "\nWorker interrupted. Schedule disabled; check before rescheduling.";
                    $interrupted[] = $item;
                }
            }
            unset($item);
            uasort($items, static fn (array $a, array $b): int =>
                strcmp($a['nextRunAt'] ?? '', $b['nextRunAt'] ?? ''));
            foreach ($items as &$item) {
                if (!$item['enabled'] || $item['nextRunAt'] === null
                    || new \DateTimeImmutable($item['nextRunAt']) > $now) {
                    continue;
                }
                $item['revision'] = ($item['revision'] ?? 0) + 1;
                $due = new \DateTimeImmutable($item['nextRunAt']);
                $item['localTime'] ??= $due->setTimezone(new \DateTimeZone($item['timezone']))->format('H:i:s');
                $item['lastRun'] = [
                    'status' => 'running',
                    'scheduledAt' => $item['nextRunAt'],
                    'startedAt' => $now->format(DATE_ATOM),
                    'finishedAt' => null,
                    'exitCode' => null,
                    'output' => '',
                ];
                $item['nextRunAt'] = self::nextRun($due, $item['repeat'], $item['timezone'], $now, $item['localTime']);
                if ($item['nextRunAt'] === null) {
                    $item['enabled'] = false;
                }

                return $item;
            }

            return null;
        });
    }

    /** Missed recurrences are coalesced into one run; daily/weekly schedules preserve local wall time. */
    public static function nextRun(
        \DateTimeImmutable $due,
        string $repeat,
        string $timezone,
        \DateTimeImmutable $now,
        ?string $localTime = null,
    ): ?string {
        if ($repeat === 'once') {
            return null;
        }
        $step = match ($repeat) {
            'hourly' => '+1 hour',
            'daily' => '+1 day',
            'weekly' => '+1 week',
            default => throw new \InvalidArgumentException('Invalid repeat interval.'),
        };
        $next = $due->setTimezone(new \DateTimeZone($repeat === 'hourly' ? 'UTC' : $timezone));
        $time = array_map('intval', explode(':', $localTime ?? $next->format('H:i:s')));
        do {
            // Use noon for calendar arithmetic so a missing local hour does not shift later runs.
            $next = $repeat === 'hourly'
                ? $next->modify($step)
                : $next->setTime(12, 0)->modify($step)->setTime(...$time);
        } while ($next <= $now);

        return $next->setTimezone(new \DateTimeZone('UTC'))->format(DATE_ATOM);
    }

    private function notifyFailure(array $item): void
    {
        try {
            $results = $this->notifier->notify($item);
        } catch (\Throwable $exception) {
            $results = [['status' => 'failed', 'error' => $exception->getMessage()]];
        }
        $this->saveResult($item['id'], ['notifications' => $results]);
    }

    private function saveResult(string $id, array $result): void
    {
        $this->store->update(static function (array &$items) use ($id, $result): void {
            if (isset($items[$id])) {
                $items[$id]['lastRun'] = array_replace($items[$id]['lastRun'], $result);
            }
        });
    }
}
