<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Watza\CommandCenterBundle\Parameter\CommandRunParameters;

/** @internal */
final readonly class CommandScheduleRunner
{
    public function __construct(private CommandScheduleStore $store, private CommandCenterService $commands)
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
            $item = $this->claim(new \DateTimeImmutable());
            if ($item === null) {
                return;
            }
            $output = '';
            $exitCode = null;
            $error = null;
            $lastFlush = microtime(true);
            try {
                $parameters = new CommandRunParameters($item['command'], '', $item['tokens'], $item['phpCode']);
                $this->commands->execute($parameters, function (array $event) use (
                    $item, &$output, &$exitCode, &$error, &$lastFlush,
                ): void {
                    if ($event['type'] === 'exit') {
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
                });
            } catch (\Throwable $exception) {
                $error = $exception->getMessage();
                $output = substr($output . "\n" . $error, -1000000);
            }
            $this->saveResult($item['id'], [
                'status' => $error === null && $exitCode === 0 ? 'success' : 'failed',
                'finishedAt' => gmdate(DATE_ATOM),
                'exitCode' => $exitCode,
                'output' => $output,
            ]);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    private function claim(\DateTimeImmutable $now): ?array
    {
        return $this->store->update(static function (array &$items) use ($now): ?array {
            // No other runner holds runner.lock: any leftover running job was interrupted.
            // Never retry it automatically, as it may already have caused side effects.
            foreach ($items as &$item) {
                if (($item['lastRun']['status'] ?? null) === 'running') {
                    $item['enabled'] = false;
                    $item['lastRun']['status'] = 'interrupted';
                    $item['lastRun']['finishedAt'] = $now->format(DATE_ATOM);
                    $item['lastRun']['output'] .= "\nWorker interrupted. Schedule disabled; check before rescheduling.";
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
                $due = new \DateTimeImmutable($item['nextRunAt']);
                $item['lastRun'] = [
                    'status' => 'running',
                    'scheduledAt' => $item['nextRunAt'],
                    'startedAt' => $now->format(DATE_ATOM),
                    'finishedAt' => null,
                    'exitCode' => null,
                    'output' => '',
                ];
                $item['nextRunAt'] = self::nextRun($due, $item['repeat'], $item['timezone'], $now);
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
        $next = $due->setTimezone(new \DateTimeZone($timezone));
        do {
            $next = $next->modify($step);
        } while ($next <= $now);

        return $next->setTimezone(new \DateTimeZone('UTC'))->format(DATE_ATOM);
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
