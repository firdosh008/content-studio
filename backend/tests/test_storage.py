import pytest

from app.services import storage


def test_key_is_namespaced_by_brand_and_kind():
    key = storage.key_for("ladder", "assets", "logo.svg")
    assert key.startswith("ladder/assets/")
    assert key.endswith("-logo.svg")


def test_key_rejects_path_traversal():
    with pytest.raises(ValueError):
        storage.key_for("ladder", "assets", "../../etc/passwd")


def test_key_rejects_a_nested_path():
    with pytest.raises(ValueError):
        storage.key_for("ladder", "assets", "a/b.png")


def test_put_then_get_round_trips(fake_storage):
    key = storage.put("ladder/assets/x.txt", b"hello", "text/plain")
    assert storage.get(key) == b"hello"


def test_delete_removes_the_object(fake_storage):
    storage.put("ladder/assets/x.txt", b"hello", "text/plain")
    storage.delete("ladder/assets/x.txt")
    assert "ladder/assets/x.txt" not in fake_storage
