# geo — cibles opérationnelles. Le déploiement suit le plan de déploiement plateforme
# (ARCH-17/BR-55, push-CI, ADR-0028) ; la cible `k8s-deploy-preprod` est appelée par le
# workflow CD `cd-preprod.yml` (jamais à la main en temps normal).

GEO_IMAGE      ?= rg.fr-par.scw.cloud/sentropic-geo/geo-api
PREPROD_OVERLAY := deploy/k8s/overlays/preprod

# Déploie la ligne servie geo-api en preprod : épingle le DIGEST immuable dans l'overlay
# (kustomize edit), applique, attend le rollout (self-gate santé). GEO_DIGEST requis
# (sha256:… du build post-merge) — le CD le passe ; jamais un tag mouvant.
.PHONY: k8s-deploy-preprod
k8s-deploy-preprod:
	@test -n "$(GEO_DIGEST)" || { echo "ERREUR: GEO_DIGEST requis (sha256:...)"; exit 1; }
	cd $(PREPROD_OVERLAY) && kustomize edit set image geo-api=$(GEO_IMAGE)@$(GEO_DIGEST)
	kubectl apply -k $(PREPROD_OVERLAY)
	kubectl rollout status deployment/geo-api -n geo-preprod --timeout=180s

# Rendu client-side des overlays (validation locale, sans cluster).
.PHONY: k8s-render-preprod
k8s-render-preprod:
	kubectl kustomize $(PREPROD_OVERLAY)

.PHONY: k8s-render-prod
k8s-render-prod:
	kubectl kustomize deploy/k8s/overlays/prod
