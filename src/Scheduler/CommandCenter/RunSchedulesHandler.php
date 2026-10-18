<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Scheduler\CommandCenter;

use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Watza\CommandCenterBundle\Service\CommandScheduleRunner;

/** @internal */
#[AsMessageHandler]
final readonly class RunSchedulesHandler
{
    public function __construct(private CommandScheduleRunner $runner)
    {
    }

    public function __invoke(RunSchedules $message): void
    {
        $this->runner->tick();
    }
}
