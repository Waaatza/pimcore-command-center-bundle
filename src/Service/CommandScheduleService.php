<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Pimcore\Bundle\StudioBackendBundle\Security\Service\SecurityServiceInterface;
use Pimcore\Model\User;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Security\Csrf\CsrfToken;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;
use Watza\CommandCenterBundle\Parameter\CommandScheduleActionParameters;
use Watza\CommandCenterBundle\Parameter\CommandScheduleParameters;
use Watza\CommandCenterBundle\Parameter\CommandScheduleUpdateParameters;
use Watza\CommandCenterBundle\Parameter\ScheduleNotificationsParameters;

/** @internal */
final readonly class CommandScheduleService
{
    public function __construct(
        private CommandScheduleStore $store,
        private CommandCenterService $commands,
        private CsrfTokenManagerInterface $csrfTokenManager,
        private SecurityServiceInterface $security,
        private ScheduleRecipientService $recipients,
        private ?CommandWorkflowService $workflows = null,
    ) {
    }

    public function list(): array
    {
        $heartbeat = $this->store->directory() . '/heartbeat';

        return [
            'recipients' => $this->recipients->list(),
            'lastHeartbeat' => is_file($heartbeat) ? gmdate(DATE_ATOM, filemtime($heartbeat)) : null,
            'schedules' => array_map(static function (array $item): array {
                unset($item['phpCode'], $item['tokens'], $item['lastRun']['output'], $item['workflow']['steps']);

                return $item;
            }, $this->store->all()),
        ];
    }

    public function get(string $id): array
    {
        foreach ($this->store->all() as $item) {
            if ($item['id'] === $id) {
                return $item;
            }
        }

        throw new NotFoundHttpException('Schedule not found.');
    }

    public function create(CommandScheduleParameters $parameters): array
    {
        [$fields, $user] = $this->validatedFields($parameters);
        $item = $fields + [
            'id' => bin2hex(random_bytes(16)),
            'enabled' => true,
            'revision' => 0,
            'createdAt' => gmdate(DATE_ATOM),
            'createdBy' => $user->getId(),
            'lastRun' => null,
        ];
        $this->store->update(static function (array &$items) use ($item): void {
            if (count($items) >= 50) {
                throw new BadRequestHttpException('Maximum of 50 schedules reached.');
            }
            $items[$item['id']] = $item;
        });

        return $item;
    }

    public function update(CommandScheduleUpdateParameters $parameters): array
    {
        [$fields, $user] = $this->validatedFields($parameters->schedule, $this->get($parameters->id)['workflow'] ?? null);

        return $this->store->update(static function (array &$items) use ($parameters, $fields, $user): array {
            $item = $items[$parameters->id] ?? throw new NotFoundHttpException('Schedule not found.');
            if (($item['lastRun']['status'] ?? null) === 'running') {
                throw new ConflictHttpException('A running schedule cannot be edited. Wait until execution finishes.');
            }
            if (($item['revision'] ?? 0) !== $parameters->revision) {
                throw new ConflictHttpException('The schedule has changed. Reload it before saving.');
            }
            $items[$parameters->id] = array_replace($item, $fields, [
                'enabled' => $parameters->enabled,
                'revision' => ($item['revision'] ?? 0) + 1,
                'updatedAt' => gmdate(DATE_ATOM),
                'updatedBy' => $user->getId(),
            ]);

            return $items[$parameters->id];
        });
    }

    private function validatedFields(CommandScheduleParameters $parameters, ?array $preservedWorkflow = null): array
    {
        $this->checkToken($parameters->execution->csrfToken);
        $workflow = $preservedWorkflow;
        if ($workflow === null && $parameters->workflow !== null) {
            $reference = $parameters->workflow;
            if (!is_string($reference['id'] ?? null) || !is_int($reference['revision'] ?? null)
                || $this->workflows === null || array_diff(array_keys($reference), ['id', 'revision'])) {
                throw new BadRequestHttpException('Invalid workflow reference.');
            }
            $workflow = $this->workflows->snapshot($reference['id'], $reference['revision']);
        }
        $execution = $parameters->execution;
        if ($workflow !== null) {
            foreach ($workflow['steps'] as $step) {
                $this->commands->validate(new \Watza\CommandCenterBundle\Parameter\CommandRunParameters(
                    $step['command'], tokens: $step['tokens'], phpCode: $step['phpCode'] ?? null,
                ));
            }
            $first = $workflow['steps'][0];
            $execution = new \Watza\CommandCenterBundle\Parameter\CommandRunParameters(
                $first['command'], tokens: $first['tokens'], phpCode: $first['phpCode'] ?? null,
            );
        } else {
            $this->commands->validate($execution);
        }
        $this->recipients->validate($parameters->notificationRecipientIds, $parameters->notificationChannels);
        try {
            $runAt = new \DateTimeImmutable($parameters->runAt);
            new \DateTimeZone($parameters->timezone);
        } catch (\Exception) {
            throw new BadRequestHttpException('Invalid schedule date or timezone.');
        }
        if ($runAt <= new \DateTimeImmutable() || trim($parameters->label) === ''
            || !in_array($parameters->repeat, ['once', 'hourly', 'daily', 'weekly'], true)) {
            throw new BadRequestHttpException('Choose a future date, a name and a valid repeat interval.');
        }
        $user = $this->security->getCurrentUser();
        if (!$user instanceof User || !$user->isAdmin()) {
            throw new AccessDeniedHttpException('Administrator access required.');
        }

        return [[
            'label' => trim($parameters->label),
            'command' => $execution->command,
            'tokens' => $execution->tokens,
            'phpCode' => $execution->phpCode,
            'repeat' => $parameters->repeat,
            'timezone' => $parameters->timezone,
            'nextRunAt' => $runAt->setTimezone(new \DateTimeZone('UTC'))->format(DATE_ATOM),
            'notificationRecipientIds' => array_values(array_unique($parameters->notificationRecipientIds)),
            'notificationChannels' => array_values(array_unique($parameters->notificationChannels)),
        ] + ($workflow === null ? [] : ['workflow' => $workflow]), $user];
    }

    public function action(CommandScheduleActionParameters $parameters): void
    {
        $this->checkToken($parameters->csrfToken);
        $this->store->update(static function (array &$items) use ($parameters): void {
            $item = $items[$parameters->id] ?? throw new NotFoundHttpException('Schedule not found.');
            if ($parameters->action === 'delete') {
                if (($item['lastRun']['status'] ?? null) === 'running') {
                    throw new BadRequestHttpException('A running schedule cannot be deleted. Disable it first.');
                }
                unset($items[$parameters->id]);
            } elseif (in_array($parameters->action, ['enable', 'disable'], true)) {
                if ($parameters->action === 'enable' && $item['nextRunAt'] === null) {
                    throw new BadRequestHttpException('This one-time schedule has already run. Create a new schedule.');
                }
                $items[$parameters->id]['enabled'] = $parameters->action === 'enable';
                $items[$parameters->id]['revision'] = ($item['revision'] ?? 0) + 1;
            } else {
                throw new BadRequestHttpException('Invalid schedule action.');
            }
        });
    }

    public function updateNotifications(ScheduleNotificationsParameters $parameters): void
    {
        $this->checkToken($parameters->csrfToken);
        $this->recipients->validate($parameters->notificationRecipientIds, $parameters->notificationChannels);
        $this->store->update(static function (array &$items) use ($parameters): void {
            if (!isset($items[$parameters->id])) {
                throw new NotFoundHttpException('Schedule not found.');
            }
            $items[$parameters->id]['revision'] = ($items[$parameters->id]['revision'] ?? 0) + 1;
            $items[$parameters->id]['notificationRecipientIds'] = array_values(
                array_unique($parameters->notificationRecipientIds),
            );
            $items[$parameters->id]['notificationChannels'] = array_values(
                array_unique($parameters->notificationChannels),
            );
        });
    }

    private function checkToken(string $token): void
    {
        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('command-center', $token))) {
            throw new AccessDeniedHttpException('Invalid CSRF token. Reload the Command Center.');
        }
    }
}
