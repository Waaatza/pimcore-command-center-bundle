<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

use Pimcore\Bundle\StudioBackendBundle\Notification\Schema\SendNotificationParameters;
use Pimcore\Bundle\StudioBackendBundle\Notification\Service\SendNotificationServiceInterface;
use Pimcore\Cache\RuntimeCache;
use Pimcore\Model\User;
use Pimcore\Model\UserInterface;
use Psr\Log\NullLogger;
use Watza\CommandCenterBundle\Service\FailureNotificationService;
use Watza\CommandCenterBundle\Service\ScheduleRecipientService;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

$transport = new class implements SendNotificationServiceInterface {
    public array $messages = [];
    public function sendNotification(
        SendNotificationParameters $parameters,
        ?UserInterface $sender,
        ?string $payload = null,
    ): void {
        if ($parameters->getRecipientId() === 101) {
            throw new RuntimeException('Test delivery failure');
        }
        $this->messages[] = $parameters;
    }
};
foreach ([101, 102] as $id) {
    $user = new User();
    $user->setId($id);
    $user->setType('user');
    $user->setActive(true);
    $user->setAdmin(true);
    $user->setEmail('invalid');
    RuntimeCache::set('user_' . $id, $user);
}
try {
    $recipients = new ScheduleRecipientService();
    $recipients->validate([101, 102], ['studio']);
    try {
        $recipients->validate([101], ['email']);
        throw new RuntimeException('Email without valid address accepted');
    } catch (BadRequestHttpException) {
    }
    $service = new FailureNotificationService($transport, new NullLogger());
    $schedule = [
        'id' => 'test', 'label' => '<script>example</script>', 'command' => 'test:fail',
        'notificationRecipientIds' => [101, 102], 'notificationChannels' => ['studio', 'email'],
        'phpCode' => 'private-script-code', 'tokens' => ['private-argument'],
        'lastRun' => ['status' => 'failed', 'exitCode' => 7, 'output' => 'private-command-output'],
    ];
    $results = $service->notify($schedule);
    if (count($results) !== 4 || count($transport->messages) !== 1) {
        throw new RuntimeException('One failed delivery blocked other recipients or channels');
    }
    $message = $transport->messages[0]->getMessage();
    if (!str_contains($message, "\nCommand: test:fail\n") || str_contains($message, '<br')
        || str_contains($message, 'private-')) {
        throw new RuntimeException('Notification content lost plain-text line breaks or includes private execution data');
    }
    if ($results[0]['status'] !== 'failed' || $results[2]['status'] !== 'sent') {
        throw new RuntimeException('Delivery results not recorded independently');
    }
    unset($schedule['notificationRecipientIds'], $schedule['notificationChannels']);
    if ($service->notify($schedule) !== []) {
        throw new RuntimeException('Legacy schedule unexpectedly sent notifications');
    }
    echo "Failure notification checks passed (no real messages sent).\n";
} finally {
    foreach ([101, 102] as $id) {
        RuntimeCache::getInstance()->offsetUnset('user_' . $id);
    }
}
