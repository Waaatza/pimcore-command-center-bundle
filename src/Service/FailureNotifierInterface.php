<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

/** @internal */
interface FailureNotifierInterface
{
    /** Return delivery results without changing the execution outcome. */
    public function notify(array $schedule): array;
}
