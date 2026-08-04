from unittest import mock

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.throttling import ScopedRateThrottle

from tests.base_test import BaseFeatureTest


class RegistrationTest(BaseFeatureTest):
    def _register(self, **overrides):
        payload = {
            "username": "newpilot",
            "email": "newpilot@example.com",
            "password": "correct-horse-battery-staple",
            "passwordConfirm": "correct-horse-battery-staple",
        }
        payload.update(overrides)
        return self.client.post(reverse("auth-register"), payload, format="json")

    def test_signup_creates_a_usable_account(self):
        response = self._register()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        body = response.json()
        self.assertIn("token", body)
        self.assertEqual(body["user"]["username"], "newpilot")

        user = User.objects.get(username="newpilot")
        self.assertTrue(user.check_password("correct-horse-battery-staple"))
        self.assertTrue(Token.objects.filter(user=user, key=body["token"]).exists())

        # The token from signup itself authenticates further requests.
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {body['token']}")
        me_response = self.client.get(reverse("auth-me"))
        self.assertEqual(me_response.status_code, status.HTTP_200_OK)
        self.assertEqual(me_response.json()["username"], "newpilot")

    def test_signup_rejects_a_duplicate_username(self):
        User.objects.create_user(username="newpilot", password="s3cur3-pass!")

        response = self._register()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.json())
        self.assertEqual(User.objects.filter(username="newpilot").count(), 1)

    def test_signup_rejects_a_duplicate_username_case_insensitively(self):
        User.objects.create_user(username="NewPilot", password="s3cur3-pass!")

        response = self._register()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.json())

    def test_signup_rejects_a_weak_password(self):
        response = self._register(password="password", passwordConfirm="password")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("password", response.json())
        self.assertFalse(User.objects.filter(username="newpilot").exists())

    def test_signup_rejects_a_password_too_similar_to_the_username(self):
        response = self._register(
            username="quietwatertower",
            password="quietwatertower123",
            passwordConfirm="quietwatertower123",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("password", response.json())

    def test_signup_rejects_mismatched_password_confirmation(self):
        response = self._register(passwordConfirm="something-else-entirely")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("passwordConfirm", response.json())
        self.assertFalse(User.objects.filter(username="newpilot").exists())

    def test_signup_rejects_an_invalid_email(self):
        response = self._register(email="not-an-email")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", response.json())

    def test_signup_rejects_an_invalid_username(self):
        response = self._register(username="bad username with spaces")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("username", response.json())

    def test_signup_is_reachable_even_when_require_auth_is_on(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self._register()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class RegistrationThrottleTest(BaseFeatureTest):
    def setUp(self):
        super().setUp()
        cache.clear()

    def tearDown(self):
        cache.clear()
        super().tearDown()

    def test_registration_is_throttled_after_the_configured_rate(self):
        with mock.patch.object(ScopedRateThrottle, "THROTTLE_RATES", {"register": "1/min"}):
            first = self.client.post(
                reverse("auth-register"),
                {
                    "username": "throttleuser1",
                    "email": "throttle1@example.com",
                    "password": "correct-horse-battery-staple",
                    "passwordConfirm": "correct-horse-battery-staple",
                },
                format="json",
            )
            self.assertEqual(first.status_code, status.HTTP_201_CREATED)

            second = self.client.post(
                reverse("auth-register"),
                {
                    "username": "throttleuser2",
                    "email": "throttle2@example.com",
                    "password": "correct-horse-battery-staple",
                    "passwordConfirm": "correct-horse-battery-staple",
                },
                format="json",
            )
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertFalse(User.objects.filter(username="throttleuser2").exists())
