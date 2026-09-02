import qrcode

data = "1026"

qr = qrcode.QRCode(
    version=1,
    box_size=10,
    border=4
)

qr.add_data(data)
qr.make(fit=True)

image = qr.make_image()

image.save("my_qr_code.png")

print("QR code saved as my_qr_code.png")