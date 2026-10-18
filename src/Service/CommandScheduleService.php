<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Pimcore\Bundle\StudioBackendBundle\Security\Service\SecurityServiceInterface;
use Pimcore\Model\User;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Security\Csrf\CsrfToken;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;
use Watza\CommandCenterBundle\Parameter\CommandScheduleActionParameters;
use Watza\CommandCenterBundle\Parameter\CommandScheduleParameters;

/** @internal */
final readonly class CommandScheduleService
{
    public function __construct(
        private CommandScheduleStore $store,
        private CommandCenterService $commands,
        private CsrfTokenManagerInterface $csrfTokenManager,
        private SecurityServiceInterface $security,
    ) {
    }

    public function list(): array
    {
        $heartbeat = $this->store->directory() . '/heartbeat';

        return [
            'lastHeartbeat' => is_file($heartbeat) ? gmdate(DATE_ATOM, filemtime($heartbeat)) : null,
            'schedules' => array_map(static function (array $item): array {
                unset($item['phpCode'], $item['tokens'], $item['lastRun']['output']);

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
        $this->checkToken($parameters->execution->csrfToken);
        $this->commands->validate($parameters->execution);
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
        $item = [
            'id' => bin2hex(random_bytes(16)),
            'label' => trim($parameters->label),
            'command' => $parameters->execution->command,
            'tokens' => $parameters->execution->tokens,
            'phpCode' => $parameters->execution->phpCode,
            'repeat' => $parameters->repeat,
            'timezone' => $parameters->timezone,
            'nextRunAt' => $runAt->setTimezone(new \DateTimeZone('UTC'))->format(DATE_ATOM),
            'enabled' => true,
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
            } else {
                throw new BadRequestHttpException('Invalid schedule action.');
            }
        });
    }

    private function checkToken(string $token): void
    {
        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('command-center', $token))) {
            throw new AccessDeniedHttpException('Invalid CSRF token. Reload the Command Center.');
        }
    }
}
