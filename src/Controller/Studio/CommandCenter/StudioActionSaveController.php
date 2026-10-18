<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Parameter\StudioActionSaveParameters;
use Watza\CommandCenterBundle\Service\StudioActionService;

/** @internal */
final class StudioActionSaveController
{
    public function __construct(private readonly StudioActionService $service)
    {
    }

    #[Route(
        '/command-center/actions/save',
        name: 'watza_command_center_studioactionsave',
        methods: ['POST'],
    )]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(
        path: '/command-center/actions/save', summary: 'command_center_studioactionsave', tags: ['Command Center'],
    )]
    #[OA\Response(response: 200, description: 'command_center_studioactionsave_success')]
    #[OA\Response(response: 403, description: 'Access denied')]
    public function __invoke(#[MapRequestPayload] StudioActionSaveParameters $parameters): JsonResponse
    {
        return new JsonResponse($this->service->save($parameters), headers: ['Cache-Control' => 'no-store']);
    }
}
