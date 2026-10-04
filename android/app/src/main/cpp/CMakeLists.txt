cmake_minimum_required(VERSION 3.22.1)

project("cursed-local-engine")

# llama.cpp is vendored (not a submodule) under ./llama.cpp, pruned to just
# what a library consumer needs: ggml, src (the llama.cpp public API impl),
# include, cmake. tools/examples/tests/common/vendor were stripped out since
# they're only built as a top-level project (LLAMA_STANDALONE), which we are
# not - force these off explicitly since add_subdirectory() would otherwise
# fail looking for directories that no longer exist on disk.
#
# Vulkan (GPU) backend is off for now: ggml-vulkan's CMakeLists requires
# find_package(SPIRV-Headers CONFIG REQUIRED), which the Android NDK doesn't
# bundle (only glslc is bundled, under shader-tools/) - it needs the full
# LunarG Vulkan SDK on the host. Flip this to ON once that's installed; no
# other changes needed, ggml auto-detects and links the backend either way.
set(GGML_VULKAN OFF CACHE BOOL "Vulkan backend" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)

add_subdirectory(llama.cpp)

add_library(${PROJECT_NAME} SHARED
    cursed-local-engine.cpp
)

target_include_directories(${PROJECT_NAME} PRIVATE
    llama.cpp/include
    llama.cpp/ggml/include
)

target_link_libraries(${PROJECT_NAME}
    android
    log
    llama
    ggml
)

# Support 16 KB page sizes
target_link_options(${PROJECT_NAME} PRIVATE "-Wl,-z,max-page-size=16384")
