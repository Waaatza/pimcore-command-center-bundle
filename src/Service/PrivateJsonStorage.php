<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/** @internal */
final readonly class PrivateJsonStorage
{
    public function __construct(
        #[Autowire('%kernel.project_dir%/var/command-center/%kernel.environment%')]
        private string $baseDirectory,
    ) {
    }

    public function directory(string $area): string
    {
        if (!preg_match('/^[a-z-]+$/D', $area)) {
            throw new \InvalidArgumentException('Invalid storage area.');
        }
        $path = $this->baseDirectory . '/' . $area;
        if (!is_dir($path) && !@mkdir($path, 0700, true) && !is_dir($path)) {
            throw new \RuntimeException('Cannot create private Command Center storage.');
        }

        return $path;
    }

    public function read(string $area, string $id): ?array
    {
        $path = $this->path($area, $id);
        $data = @file_get_contents($path);

        if ($data === false && is_file($path)) {
            throw new \RuntimeException('Cannot read private Command Center data.');
        }

        return $data === false ? null : json_decode($data, true, 512, JSON_THROW_ON_ERROR);
    }

    public function write(string $area, string $id, array $value): void
    {
        $path = $this->path($area, $id);
        $temporary = tempnam(dirname($path), '.write-');
        if ($temporary === false) {
            throw new \RuntimeException('Cannot prepare private JSON write.');
        }
        try {
            $json = json_encode($value, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
            if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, $path)) {
                throw new \RuntimeException('Cannot save private Command Center data.');
            }
        } finally {
            if (is_file($temporary)) {
                unlink($temporary);
            }
        }
    }

    public function transaction(string $area, string $id, callable $update): mixed
    {
        $path = $this->path($area, $id);
        $handle = fopen($path . '.lock', 'c');
        if ($handle === false) {
            throw new \RuntimeException('Cannot open private storage lock.');
        }
        try {
            if (!flock($handle, LOCK_EX)) {
                throw new \RuntimeException('Cannot lock private storage.');
            }
            $value = $this->read($area, $id);
            $result = $update($value);
            if ($value !== null) {
                $this->write($area, $id, $value);
            }

            return $result;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    private function path(string $area, string $id): string
    {
        if (!preg_match('/^[a-z0-9-]+$/D', $id)) {
            throw new \InvalidArgumentException('Invalid storage identifier.');
        }

        return $this->directory($area) . '/' . $id . '.json';
    }
}
