<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Preview;

/** Implementations MUST be read-only: never execute the command or persist changes. */
interface CommandPreviewProviderInterface
{
    public function command(): string;

    /** @param list<string> $tokens Resolved arguments, exactly as used for execution. */
    public function preview(array $tokens): CommandPreviewResult;
}
