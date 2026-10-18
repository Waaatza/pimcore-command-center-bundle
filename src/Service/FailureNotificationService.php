<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Pimcore\Bundle\StudioBackendBundle\Notification\Schema\SendNotificationParameters;
use Pimcore\Bundle\StudioBackendBundle\Notification\Service\SendNotificationServiceInterface;
use Pimcore\Mail;
use Pimcore\Model\User;
use Psr\Log\LoggerInterface;

/** @internal */
final readonly class FailureNotificationService implements FailureNotifierInterface
{
    public function __construct(
        private SendNotificationServiceInterface $notifications,
        private LoggerInterface $logger,
    ) {
    }

    public function notify(array $schedule): array
    {
        $channels = array_values(array_intersect($schedule['notificationChannels'] ?? [], ['email', 'studio']));
        $title = 'Command Center: ' . $schedule['label'] . ' failed';
        $run = $schedule['lastRun'];
        $text = sprintf(
            "Schedule: %s\nCommand: %s\nStatus: %s\nExit code: %s\nStarted: %s\nFinished: %s\n"
            . "\nOpen System > Command Center > Geplante Ausführungen to inspect the full output.",
            $schedule['label'], $schedule['command'], $run['status'], $run['exitCode'] ?? 'unknown',
            $run['startedAt'] ?? 'unknown', $run['finishedAt'] ?? 'unknown',
        );
        $results = [];
        foreach (array_unique($schedule['notificationRecipientIds'] ?? []) as $id) {
            foreach ($channels as $channel) {
                try {
                    $user = User::getById($id);
                    if (!$user instanceof User || !$user->getActive()) {
                        throw new \RuntimeException('Recipient no longer exists or is inactive.');
                    }
                    if ($channel === 'studio') {
                        if (!$user->isAllowed('notifications')) {
                            throw new \RuntimeException('Recipient no longer has the notifications permission.');
                        }
                        $this->notifications->sendNotification(
                            new SendNotificationParameters($id, $title, $text), null,
                        );
                    } else {
                        if (!filter_var($user->getEmail(), FILTER_VALIDATE_EMAIL)) {
                            throw new \RuntimeException('Recipient has no valid email address.');
                        }
                        (new Mail())->to($user->getEmail())->subject($title)->text($text)->send();
                    }
                    $results[] = ['userId' => $id, 'channel' => $channel, 'status' => 'sent'];
                } catch (\Throwable $exception) {
                    $results[] = [
                        'userId' => $id, 'channel' => $channel, 'status' => 'failed',
                        'error' => $exception->getMessage(),
                    ];
                    $this->logger->error('Command Center failure notification could not be sent.', [
                        'scheduleId' => $schedule['id'], 'userId' => $id, 'channel' => $channel,
                        'exception' => $exception,
                    ]);
                }
            }
        }

        return $results;
    }
}
