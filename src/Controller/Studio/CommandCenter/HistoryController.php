<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapQueryString;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Parameter\HistoryQueryParameters;
use Watza\CommandCenterBundle\Service\CommandHistoryStore;
use OpenApi\Attributes as OA;

/** @internal */
final class HistoryController
{
    public function __construct(private readonly CommandHistoryStore $history)
    {
    }

    #[Route('/command-center/history', name: 'watza_command_center_history', methods: ['GET'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Get(path: '/command-center/history', summary: 'command_center_history', tags: ['Command Center'])]
    #[OA\Response(response: 200, description: 'command_center_history_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapQueryString] HistoryQueryParameters $query = new HistoryQueryParameters()): JsonResponse
    {
        return new JsonResponse($this->history->list($query->page, $query->status, $query->source, $query->search), headers: ['Cache-Control' => 'private, no-store']);
    }
}
