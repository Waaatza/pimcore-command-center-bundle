<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Service\TerminalService;

/** @internal */
final class TerminalSettingsController
{
    public function __construct(private readonly TerminalService $service)
    {
    }

    #[Route('/command-center/terminal/settings', name: 'watza_command_center_terminal_settings', methods: ['GET'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Get(
        path: '/command-center/terminal/settings',
        summary: 'command_center_terminal_settings',
        tags: ['Command Center'],
    )]
    #[OA\Response(response: 200, description: 'command_center_terminal_settings_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(): JsonResponse
    {
        return new JsonResponse($this->service->settings(), headers: ['Cache-Control' => 'no-store']);
    }
}
