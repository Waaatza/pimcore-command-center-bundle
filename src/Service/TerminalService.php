<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Pimcore\Bundle\StudioBackendBundle\Security\Service\SecurityServiceInterface;
use Pimcore\Model\User;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;
use Watza\CommandCenterBundle\Parameter\TerminalConsumeParameters;
use Watza\CommandCenterBundle\Parameter\TerminalTicketParameters;

/** @internal */
final readonly class TerminalService
{
    public function __construct(
        private PrivateJsonStorage $storage,
        private CommandCenterService $commands,
        private SecurityServiceInterface $security,
        private RequestStack $requests,
        private array $config,
    ) {
    }

    public function settings(): array
    {
        $this->administrator();

        return ['enabled' => $this->config['enabled']];
    }

    public function issue(TerminalTicketParameters $parameters): array
    {
        $user = $this->administrator();
        $this->commands->verifyCsrf($parameters->csrfToken);
        $this->configured();
        $request = $this->requests->getCurrentRequest();
        if ($request?->headers->get('Origin') !== $this->config['origin'] || !$request->hasSession()) {
            throw new AccessDeniedHttpException('Invalid terminal origin or session.');
        }
        if ($parameters->sessionId !== null && !preg_match('/^[a-f0-9]{32}$/D', $parameters->sessionId)) {
            throw new AccessDeniedHttpException('Invalid terminal session.');
        }
        $ticket = bin2hex(random_bytes(32));
        $owner = hash_hmac('sha256', $user->getId() . ':' . $request->getSession()->getId(), $this->config['secret']);
        $this->storage->transaction('terminal', 'tickets', function (?array &$tickets) use (
            $ticket,
            $owner,
            $parameters,
            $user,
        ): void {
            $tickets = array_filter($tickets ?? [], static fn (array $item): bool => $item['expires'] > time());
            if (count($tickets) >= 200) {
                throw new ServiceUnavailableHttpException(null, 'Too many pending terminal connections.');
            }
            $tickets[hash('sha256', $ticket)] = [
                'owner' => $owner,
                'actorId' => $user->getId(),
                'sessionId' => $parameters->sessionId,
                'expires' => time() + 30,
            ];
        });

        return ['ticket' => $ticket, 'websocketPath' => $this->config['websocket_path']];
    }

    public function consume(TerminalConsumeParameters $parameters): array
    {
        $this->configured();
        $authorization = $this->requests->getCurrentRequest()?->headers->get('Authorization', '') ?? '';
        if (!hash_equals('Bearer ' . $this->config['secret'], $authorization)) {
            throw new AccessDeniedHttpException('Invalid terminal service credentials.');
        }
        $item = $this->storage->transaction('terminal', 'tickets', static function (?array &$tickets) use (
            $parameters,
        ): ?array {
            $tickets = array_filter($tickets ?? [], static fn (array $entry): bool => $entry['expires'] > time());
            $key = hash('sha256', $parameters->ticket);
            $item = $tickets[$key] ?? null;
            unset($tickets[$key]);

            return $item;
        });
        if ($item === null) {
            throw new AccessDeniedHttpException('Expired or already consumed terminal ticket.');
        }
        // Rechte nach Ausstellung erneut aus der Datenbank prüfen.
        $user = User::getById($item['actorId']);
        if (!$user instanceof User || !$user->isAdmin() || !$user->isActive()) {
            throw new AccessDeniedHttpException('Administrator access required.');
        }

        return ['owner' => $item['owner'], 'sessionId' => $item['sessionId']];
    }

    private function administrator(): User
    {
        $user = $this->security->getCurrentUser();
        if (!$user instanceof User || !$user->isAdmin() || !$user->isActive()) {
            throw new AccessDeniedHttpException('Administrator access required.');
        }

        return $user;
    }

    private function configured(): void
    {
        $origin = $this->config['origin'];
        $path = $this->config['websocket_path'];
        if (!$this->config['enabled'] || strlen($this->config['secret']) < 32
            || !is_string($origin) || !preg_match('#^https?://[^/]+$#D', $origin)
            || !is_string($path) || !preg_match('#^/[a-zA-Z0-9/_-]+$#D', $path)) {
            throw new ServiceUnavailableHttpException(null, 'Terminal is disabled or not configured.');
        }
    }
}
