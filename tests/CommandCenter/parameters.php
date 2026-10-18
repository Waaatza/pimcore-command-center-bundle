<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

use Symfony\Component\PropertyInfo\Extractor\ReflectionExtractor;
use Symfony\Component\Serializer\Encoder\JsonEncoder;
use Symfony\Component\Serializer\Normalizer\ObjectNormalizer;
use Symfony\Component\Serializer\Serializer;
use Symfony\Component\Validator\Validation;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Parameter\CommandScheduleParameters;

$serializer = new Serializer([
    new ObjectNormalizer(propertyTypeExtractor: new ReflectionExtractor()),
], [new JsonEncoder()]);
$payload = json_encode([
    'label' => 'Test plan', 'runAt' => '2030-01-01T12:00:00Z', 'repeat' => 'daily', 'timezone' => 'Europe/Berlin',
    'notificationRecipientIds' => [1, 2], 'notificationChannels' => ['email', 'studio'],
    'execution' => ['command' => 'pimcore:run-script', 'csrfToken' => 'test', 'tokens' => [], 'phpCode' => 'echo 1;'],
]);
$dto = $serializer->deserialize($payload, CommandScheduleParameters::class, 'json');
if (!$dto->execution instanceof CommandRunParameters || $dto->execution->phpCode !== 'echo 1;') {
    throw new RuntimeException('Nested execution payload was not mapped.');
}
$validator = Validation::createValidatorBuilder()->enableAttributeMapping()->getValidator();
if (count($validator->validate($dto)) !== 0) {
    throw new RuntimeException('Valid schedule payload rejected.');
}
$invalid = new CommandScheduleParameters(
    new CommandRunParameters('pimcore:run-script', ''), 'Test', '2030-01-01T12:00:00Z',
);
if (count($validator->validate($invalid)) === 0) {
    throw new RuntimeException('Nested validation did not reject missing CSRF token.');
}
$badRecipients = new CommandScheduleParameters(notificationRecipientIds: ['1']);
if (count($validator->validate($badRecipients)) === 0) {
    throw new RuntimeException('Non-integer recipient ID accepted.');
}
$badChannels = new CommandScheduleParameters(notificationChannels: ['sms']);
if (count($validator->validate($badChannels)) === 0) {
    throw new RuntimeException('Unknown delivery channel accepted.');
}
echo "Schedule payload and validation checks passed.\n";
