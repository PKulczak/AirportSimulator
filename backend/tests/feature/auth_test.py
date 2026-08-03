from unittest import mock

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.throttling import ScopedRateThrottle

from tests.base_test import BaseFeatureTest


class LoginTest(BaseFeatureTest):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="pilot", password="s3cur3-pass!")

    def _login(self, **overrides):
        payload = {"username": "pilot", "password": "s3cur3-pass!"}
        payload.update(overrides)
        return self.client.post(reverse("auth-login"), payload, format="json")

    def test_login_with_correct_credentials_returns_token_and_user(self):
        response = self._login()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertIn("token", body)
        self.assertEqual(body["user"]["username"], "pilot")
        self.assertTrue(Token.objects.filter(user=self.user, key=body["token"]).exists())

    def test_login_reuses_the_same_token_on_repeated_logins(self):
        first_token = self._login().json()["token"]
        second_token = self._login().json()["token"]

        self.assertEqual(first_token, second_token)

    def test_login_rejects_wrong_password(self):
        response = self._login(password="wrong-password")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_login_rejects_unknown_username(self):
        response = self._login(username="nobody")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_login_rejects_an_inactive_user(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])

        response = self._login()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_login_is_reachable_even_when_require_auth_is_on(self):
        # A login endpoint gated by login would be a chicken-and-egg problem.
        with override_settings(REQUIRE_AUTH=True):
            response = self._login()
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class LoginThrottleTest(BaseFeatureTest):
    """DEFAULT_THROTTLE_RATES["login"] guards against brute-forcing
    /api/auth/login/ — a deliberately low rate is patched directly onto
    ScopedRateThrottle (rather than via override_settings(REST_FRAMEWORK=...))
    since DRF's SimpleRateThrottle.THROTTLE_RATES is a class attribute
    snapshotted from api_settings at import time, not re-read per request —
    override_settings alone doesn't change it. The throttle cache is cleared
    before/after so this can't leak into (or be polluted by) any other test's
    login calls, which share one process-wide cache."""

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="pilot", password="s3cur3-pass!")
        cache.clear()

    def tearDown(self):
        cache.clear()
        super().tearDown()

    def test_login_is_throttled_after_the_configured_rate(self):
        with mock.patch.object(ScopedRateThrottle, "THROTTLE_RATES", {"login": "2/min"}):
            for _ in range(2):
                response = self.client.post(
                    reverse("auth-login"),
                    {"username": "pilot", "password": "wrong-password"},
                    format="json",
                )
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

            response = self.client.post(
                reverse("auth-login"),
                {"username": "pilot", "password": "wrong-password"},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)


class CurrentUserAndLogoutTest(BaseFeatureTest):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="pilot", password="s3cur3-pass!")
        self.token = Token.objects.create(user=self.user)

    def _authenticate(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token.key}")

    def test_me_requires_authentication_regardless_of_require_auth(self):
        response = self.client.get(reverse("auth-me"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_returns_the_authenticated_user(self):
        self._authenticate()
        response = self.client.get(reverse("auth-me"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["username"], "pilot")

    def test_logout_requires_authentication_regardless_of_require_auth(self):
        response = self.client.post(reverse("auth-logout"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_deletes_the_token(self):
        self._authenticate()
        response = self.client.post(reverse("auth-logout"))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Token.objects.filter(key=self.token.key).exists())

    def test_logout_with_session_auth_and_no_token_does_not_500(self):
        # Regression test: a session-authenticated user (SessionAuthentication
        # is kept in DEFAULT_AUTHENTICATION_CLASSES for Django-admin/
        # browsable-API use) who never called /auth/login/ has no Token row
        # at all — `request.user.auth_token.delete()` used to raise an
        # unhandled Token.DoesNotExist (a raw 500) in exactly this case.
        Token.objects.filter(user=self.user).delete()
        self.client.force_login(self.user)

        response = self.client.post(reverse("auth-logout"))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_token_no_longer_authenticates_anything_after_logout(self):
        self._authenticate()
        self.client.post(reverse("auth-logout"))

        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(reverse("simulation-list"))

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class RequireAuthGatingTest(BaseFeatureTest):
    """The core Slice 9.1 requirement: protected endpoints 401 without
    credentials once REQUIRE_AUTH is on, and 200 with a valid token — while
    staying fully open (200 with no credentials at all) by default."""

    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="pilot", password="s3cur3-pass!")
        self.token = Token.objects.create(user=self.user)

    def test_simulations_list_is_open_by_default_with_no_credentials(self):
        response = self.client.get(reverse("simulation-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_simulations_list_401s_without_credentials_once_require_auth_is_on(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(reverse("simulation-list"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_simulations_list_200s_with_a_valid_token_once_require_auth_is_on(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token.key}")
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(reverse("simulation-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_simulations_list_401s_with_a_garbage_token_once_require_auth_is_on(self):
        self.client.credentials(HTTP_AUTHORIZATION="Token not-a-real-token")
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(reverse("simulation-list"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_templates_list_is_also_gated_by_require_auth(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(reverse("template-list"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_runways_list_stays_open_even_when_require_auth_is_on(self):
        # Deliberately exempt: master reference data with no owner/sensitive
        # info, fetched unconditionally at app root (RunwayContext) —
        # including on a read-only /shared/ page, which must never require
        # login at all (see RunwayViewset).
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(reverse("runway-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
