from pathlib import Path

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers


# =========================
# Settings
# =========================

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = PROJECT_ROOT / "dataset"
MODEL_DIR = PROJECT_ROOT / "models"

IMG_SIZE = (160, 160)
BATCH_SIZE = 8
SEED = 42
EPOCHS = 20


print("=" * 60)
print("NINJA VISION - HAND SEAL CLASSIFIER")
print("=" * 60)

print(f"\nDataset: {DATASET_DIR}")


# =========================
# Dataset
# =========================

train_ds = keras.utils.image_dataset_from_directory(
    DATASET_DIR,
    validation_split=0.2,
    subset="training",
    seed=SEED,
    image_size=IMG_SIZE,
    batch_size=BATCH_SIZE,
    label_mode="binary",
)

val_ds = keras.utils.image_dataset_from_directory(
    DATASET_DIR,
    validation_split=0.2,
    subset="validation",
    seed=SEED,
    image_size=IMG_SIZE,
    batch_size=BATCH_SIZE,
    label_mode="binary",
)

class_names = train_ds.class_names

print("\nClasses:")
for index, name in enumerate(class_names):
    print(f"  {index}: {name}")

if class_names != ["none", "shadow_clone"]:
    print(
        "\nWARNING: Expected ['none', 'shadow_clone'], "
        f"but received {class_names}"
    )


# =========================
# Performance
# =========================

AUTOTUNE = tf.data.AUTOTUNE

train_ds = train_ds.prefetch(AUTOTUNE)
val_ds = val_ds.prefetch(AUTOTUNE)


# =========================
# Data augmentation
# =========================

data_augmentation = keras.Sequential(
    [
        layers.RandomRotation(0.08),
        layers.RandomZoom(0.12),
        layers.RandomTranslation(
            height_factor=0.08,
            width_factor=0.08,
        ),
        layers.RandomContrast(0.15),
    ],
    name="data_augmentation",
)


# =========================
# Pretrained model
# =========================

base_model = keras.applications.MobileNetV2(
    input_shape=IMG_SIZE + (3,),
    include_top=False,
    weights="imagenet",
)

# 처음에는 MobileNetV2 자체는 학습하지 않음
base_model.trainable = False


# =========================
# Classifier
# =========================

inputs = keras.Input(shape=IMG_SIZE + (3,))

x = data_augmentation(inputs)

x = keras.applications.mobilenet_v2.preprocess_input(x)

x = base_model(
    x,
    training=False,
)

x = layers.GlobalAveragePooling2D()(x)

x = layers.Dropout(0.25)(x)

outputs = layers.Dense(
    1,
    activation="sigmoid",
)(x)

model = keras.Model(
    inputs,
    outputs,
)


# =========================
# Train
# =========================

model.compile(
    optimizer=keras.optimizers.Adam(
        learning_rate=0.001
    ),
    loss="binary_crossentropy",
    metrics=[
        "accuracy",
        keras.metrics.Precision(name="precision"),
        keras.metrics.Recall(name="recall"),
    ],
)

model.summary()


callbacks = [
    keras.callbacks.EarlyStopping(
        monitor="val_loss",
        patience=5,
        restore_best_weights=True,
    )
]


print("\n🥷 Training started...\n")

history = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=EPOCHS,
    callbacks=callbacks,
)


# =========================
# Evaluate
# =========================

print("\n" + "=" * 60)
print("VALIDATION RESULT")
print("=" * 60)

results = model.evaluate(
    val_ds,
    verbose=0,
)

for metric_name, value in zip(
    model.metrics_names,
    results,
):
    print(
        f"{metric_name}: {value:.4f}"
    )


# =========================
# Save
# =========================

MODEL_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

model_path = (
    MODEL_DIR /
    "shadow_clone_classifier.keras"
)

model.save(model_path)

print("\n✅ Model saved!")
print(model_path)

print("\n🥷 NINJA VISION MODEL READY")