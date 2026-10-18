<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Parameter\StudioActionRequest;
use Watza\CommandCenterBundle\Service\StudioActionService;

/** @internal */
final class StudioActionPreviewController
{
    public function __construct(private readonly StudioActionService $service)
    {
    }

    #[Route(
        '/command-center/actions/preview',
        name: 'watza_command_center_studioactionpreview',
        methods: ['POST'],
    )]
    #[IsGranted('ROLE_PIMCORE_USER')]
    #[OA\Post(
        path: '/command-center/actions/preview', summary: 'command_center_studioactionpreview', tags: ['Command Center'],
    )]
    #[OA\Response(response: 200, description: 'command_center_studioactionpreview_success')]
    #[OA\Response(response: 403, description: 'Access denied')]
    public function __invoke(#[MapRequestPayload] StudioActionRequest $parameters): JsonResponse
    {
        return new JsonResponse($this->service->preview($parameters), headers: ['Cache-Control' => 'no-store']);
    }
}
