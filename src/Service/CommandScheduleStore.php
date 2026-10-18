<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/** @internal */
final readonly class CommandScheduleStore
{
    public function __construct(
        #[Autowire('%kernel.project_dir%/var/command-center/%kernel.environment%')]
        private string $directory,
    ) {
    }

    public function directory(): string
    {
        if (!is_dir($this->directory) && !mkdir($this->directory, 0700, true) && !is_dir($this->directory)) {
            throw new \RuntimeException('Cannot create command schedule directory.');
        }

        return $this->directory;
    }

    /** Apply a small, atomic update. Never hold the storage lock during command execution. */
    public function update(callable $update): mixed
    {
        $path = $this->directory() . '/schedules.json';
        $lock = fopen($this->directory() . '/storage.lock', 'c');
        if ($lock === false) {
            throw new \RuntimeException('Cannot open command schedule lock.');
        }
        $temporary = null;
        try {
            if (!flock($lock, LOCK_EX)) {
                throw new \RuntimeException('Cannot lock command schedules.');
            }
            $items = is_file($path) ? json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR) : [];
            $before = $items;
            $result = $update($items);
            if ($before === $items) {
                return $result;
            }
            $json = json_encode($items, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
            $temporary = tempnam($this->directory(), '.schedules-');
            if ($temporary === false || file_put_contents($temporary, $json) !== strlen($json)
                || !rename($temporary, $path)) {
                throw new \RuntimeException('Cannot save command schedules.');
            }

            return $result;
        } finally {
            if (is_string($temporary) && is_file($temporary)) {
                unlink($temporary);
            }
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    public function all(): array
    {
        return $this->update(static fn (array &$items): array => array_values($items));
    }
}
