<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Preview;

final readonly class CommandPreviewResult
{
    /** @param list<array{label: string, before?: string, after?: string}> $samples Maximum 20 samples. */
    public function __construct(public int $count, public array $samples = [], public string $message = '')
    {
        if ($count < 0 || count($samples) > 20) {
            throw new \InvalidArgumentException('Preview requires a non-negative count and at most 20 samples.');
        }
    }
}
