<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Parameter\TerminalTicketParameters;
use Watza\CommandCenterBundle\Service\TerminalService;

/** @internal */
final class TerminalTicketController
{
    public function __construct(private readonly TerminalService $service)
    {
    }

    #[Route('/command-center/terminal/ticket', name: 'watza_command_center_terminal_ticket', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(
        path: '/command-center/terminal/ticket',
        summary: 'command_center_terminal_ticket',
        tags: ['Command Center'],
    )]
    #[OA\Response(response: 200, description: 'command_center_terminal_ticket_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] TerminalTicketParameters $parameters): JsonResponse
    {
        return new JsonResponse($this->service->issue($parameters), headers: ['Cache-Control' => 'no-store']);
    }
}
