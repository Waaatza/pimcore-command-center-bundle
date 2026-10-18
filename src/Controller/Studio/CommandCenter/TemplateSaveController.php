<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Watza\CommandCenterBundle\Parameter\TemplateSaveParameters;
use Watza\CommandCenterBundle\Service\CommandTemplateService;

/** @internal */
final class TemplateSaveController
{
    public function __construct(private readonly CommandTemplateService $service)
    {
    }

    #[Route('/command-center/templates/save', name: 'watza_command_center_templatesave', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(path: '/command-center/templates/save', summary: 'command_center_templatesave', tags: ['Command Center'])]
    #[OA\Response(response: 200, description: 'command_center_templatesave_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] TemplateSaveParameters $parameters): JsonResponse
    {
        return new JsonResponse($this->service->save($parameters));
    }
}
