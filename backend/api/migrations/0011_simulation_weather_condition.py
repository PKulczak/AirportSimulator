from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0010_aircraft_weight_class_and_simulation_weight_mix'),
    ]

    operations = [
        migrations.AddField(
            model_name='simulation',
            name='weather_condition',
            field=models.CharField(
                choices=[
                    ('Clear', 'Clear (VMC)'),
                    ('Windy', 'Windy'),
                    ('Snow', 'Snow'),
                    ('LowVisibility', 'Low Visibility (IMC)'),
                ],
                default='Clear',
                max_length=16,
            ),
        ),
    ]
