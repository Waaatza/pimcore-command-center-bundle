<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Scheduler\CommandCenter;

use Symfony\Component\Scheduler\Attribute\AsSchedule;
use Symfony\Component\Scheduler\RecurringMessage;
use Symfony\Component\Scheduler\Schedule;
use Symfony\Component\Scheduler\ScheduleProviderInterface;

/** @internal */
#[AsSchedule('command_center')]
final readonly class ScheduleProvider implements ScheduleProviderInterface
{
    public function getSchedule(): Schedule
    {
        return (new Schedule())->add(RecurringMessage::every('10 seconds', new RunSchedules()));
    }
}
