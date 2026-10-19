<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Watza\CommandCenterBundle\Parameter\TemplateActionParameters;
use Watza\CommandCenterBundle\Service\CommandTemplateService;

/** @internal */
final class TemplateRunController
{
    public function __construct(private readonly CommandTemplateService $service)
    {
    }

    #[Route('/command-center/templates/run', name: 'watza_command_center_templaterun', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(path: '/command-center/templates/run', summary: 'command_center_templaterun', tags: ['Command Center'])]
    #[OA\Response(response: 202, description: 'command_center_templaterun_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] TemplateActionParameters $parameters): JsonResponse
    {
        return new JsonResponse($this->service->run($parameters), 202, ['Cache-Control' => 'private, no-store']);
    }
}
