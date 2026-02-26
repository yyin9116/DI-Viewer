"""
DI-Viewer — Entry Point
PySide6 + QWebEngineView architecture
"""
import sys
import os

# ensure working directory is script directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt

from overlay_browser import OverlayBrowser


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("貂宝")
    app.setQuitOnLastWindowClosed(False)

    browser = OverlayBrowser()
    browser.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
