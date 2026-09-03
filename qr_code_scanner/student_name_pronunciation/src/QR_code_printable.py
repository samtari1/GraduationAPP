import qrcode
from PIL import Image, ImageDraw, ImageFont


def create_student_qr(student_id, student_name, filename):

    # -----------------------------
    # Create QR code
    # -----------------------------

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4
    )

    # ONLY the student ID goes into the QR code
    qr.add_data(student_id)
    qr.make(fit=True)

    qr_image = qr.make_image(
        fill_color="black",
        back_color="white"
    ).convert("RGB")

    # -----------------------------
    # Create printable page
    # -----------------------------

    width = qr_image.width
    height = qr_image.height + 150

    output = Image.new(
        "RGB",
        (width, height),
        "white"
    )

    # Put QR code at the top
    output.paste(
        qr_image,
        (0, 0)
    )

    # -----------------------------
    # Add student name
    # -----------------------------

    draw = ImageDraw.Draw(output)

    try:
        font = ImageFont.truetype(
            "/System/Library/Fonts/Helvetica.ttc",
            40
        )
    except:
        font = ImageFont.load_default()

    # Center the name
    bbox = draw.textbbox(
        (0, 0),
        student_name,
        font=font
    )

    text_width = bbox[2] - bbox[0]

    x = (width - text_width) // 2
    y = qr_image.height + 30

    draw.text(
        (x, y),
        student_name,
        fill="black",
        font=font
    )

    # -----------------------------
    # Save
    # -----------------------------

    output.save(filename)

    print(f"Created: {filename}")


# Example
create_student_qr(
    "10293847",
    "John Smith",
    "john_smith_qr.png"
)