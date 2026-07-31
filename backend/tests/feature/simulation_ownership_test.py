import dramatiq
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.authtoken.models import Token

from api.models import Simulation
from tests.base_test import BaseFeatureTest


class SimulationOwnershipTest(BaseFeatureTest):
    """Slice 9.2 — per-user ownership. Scoping applies whenever the request
    carries a real authenticated user (regardless of REQUIRE_AUTH, which only
    controls whether authentication is *mandatory* — see Slice 9.1); an
    anonymous request still sees everything, matching pre-9.2 behaviour,
    since there's no owner to scope by without a real caller.
    """

    def setUp(self):
        super().setUp()
        self.user_a = User.objects.create_user(username="alice", password="s3cur3-pass!")
        self.user_b = User.objects.create_user(username="bob", password="s3cur3-pass!")
        self.admin = User.objects.create_user(
            username="admin-staff", password="s3cur3-pass!", is_staff=True
        )
        self.token_a = Token.objects.create(user=self.user_a)
        self.token_b = Token.objects.create(user=self.user_b)
        self.token_admin = Token.objects.create(user=self.admin)

    def _as(self, user_token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {user_token.key}")


class SimulationOwnershipCreateTest(SimulationOwnershipTest):
    def setUp(self):
        super().setUp()
        dramatiq.get_broker().flush_all()
        self.runways = self.create_runways(2)

    def _payload(self, **overrides):
        payload = {
            "name": "Owned run",
            "arrivalRatePerHour": 20,
            "departureRatePerHour": 15,
            "durationMinutes": 120,
            "maxWaitMinutes": 20,
            "includeClosures": False,
            "runways": [
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
                {"runwayId": self.runways[1].id, "operatingMode": "Mixed"},
            ],
        }
        payload.update(overrides)
        return payload

    def test_create_sets_owner_to_the_authenticated_user(self):
        self._as(self.token_a)
        response = self.client.post("/api/simulations/", self._payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        simulation = Simulation.objects.get(id=response.json()["id"])
        self.assertEqual(simulation.owner_id, self.user_a.id)

    def test_create_leaves_owner_null_for_an_anonymous_request(self):
        response = self.client.post("/api/simulations/", self._payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        simulation = Simulation.objects.get(id=response.json()["id"])
        self.assertIsNone(simulation.owner_id)

    def test_sweep_create_sets_owner_on_every_generated_run(self):
        self._as(self.token_a)
        payload = self._payload(
            variable="arrivalRatePerHour", rangeEnd=40, rangeStep=20
        )
        response = self.client.post(
            "/api/simulations/sweep/", payload, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        ids = [run["id"] for run in response.json()["simulations"]]
        self.assertEqual(len(ids), 2)
        owners = set(
            Simulation.objects.filter(id__in=ids).values_list("owner_id", flat=True)
        )
        self.assertEqual(owners, {self.user_a.id})


class SimulationOwnershipListTest(SimulationOwnershipTest):
    def test_list_only_returns_the_authenticated_users_own_runs(self):
        self.create_simulations(1, name="Alice run", owner=self.user_a)
        self.create_simulations(1, name="Bob run", owner=self.user_b)
        self.create_simulations(1, name="Unowned legacy run")

        self._as(self.token_a)
        response = self.client.get("/api/simulations/")

        body = response.json()
        names = {item["name"] for item in body["results"]}
        self.assertEqual(names, {"Alice run"})

    def test_anonymous_list_returns_every_run_regardless_of_owner(self):
        self.create_simulations(1, name="Alice run", owner=self.user_a)
        self.create_simulations(1, name="Bob run", owner=self.user_b)
        self.create_simulations(1, name="Unowned legacy run")

        response = self.client.get("/api/simulations/")

        body = response.json()
        names = {item["name"] for item in body["results"]}
        self.assertEqual(names, {"Alice run", "Bob run", "Unowned legacy run"})

    def test_staff_list_returns_every_users_runs(self):
        self.create_simulations(1, name="Alice run", owner=self.user_a)
        self.create_simulations(1, name="Bob run", owner=self.user_b)
        self.create_simulations(1, name="Unowned legacy run")

        self._as(self.token_admin)
        response = self.client.get("/api/simulations/")

        body = response.json()
        names = {item["name"] for item in body["results"]}
        self.assertEqual(names, {"Alice run", "Bob run", "Unowned legacy run"})


class SimulationOwnershipDetailAccessTest(SimulationOwnershipTest):
    def setUp(self):
        super().setUp()
        self.bobs_run = self.create_simulations(
            1, name="Bob's run", owner=self.user_b, status=Simulation.Status.COMPLETE
        )

    def test_metrics_detail_404s_for_another_users_run(self):
        self._as(self.token_a)
        response = self.client.get(f"/api/simulations/{self.bobs_run.id}/detail/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_metrics_detail_200s_for_the_owners_own_run(self):
        self._as(self.token_b)
        response = self.client.get(f"/api/simulations/{self.bobs_run.id}/detail/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_visualisation_404s_for_another_users_run(self):
        self._as(self.token_a)
        response = self.client.get(f"/api/simulations/{self.bobs_run.id}/visualisation/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_config_404s_for_another_users_run(self):
        self._as(self.token_a)
        response = self.client.get(f"/api/simulations/{self.bobs_run.id}/config/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_export_csv_404s_for_another_users_run(self):
        self._as(self.token_a)
        response = self.client.get(f"/api/simulations/{self.bobs_run.id}/export.csv/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cancel_404s_for_another_users_run(self):
        self._as(self.token_a)
        response = self.client.post(f"/api/simulations/{self.bobs_run.id}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_rename_404s_for_another_users_run(self):
        self._as(self.token_a)
        response = self.client.patch(
            f"/api/simulations/{self.bobs_run.id}/", {"name": "Hijacked"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.bobs_run.refresh_from_db()
        self.assertEqual(self.bobs_run.name, "Bob's run")

    def test_delete_404s_for_another_users_run_and_leaves_it_intact(self):
        self._as(self.token_a)
        response = self.client.delete(f"/api/simulations/{self.bobs_run.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Simulation.objects.filter(id=self.bobs_run.id).exists())

    def test_anonymous_request_can_still_reach_another_users_run(self):
        # No REQUIRE_AUTH, no credentials at all — matches pre-9.2 open
        # behaviour; ownership only kicks in once there's a real caller.
        response = self.client.get(f"/api/simulations/{self.bobs_run.id}/detail/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_staff_can_reach_another_users_run(self):
        self._as(self.token_admin)
        response = self.client.get(f"/api/simulations/{self.bobs_run.id}/detail/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
