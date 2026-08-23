cmake_minimum_required(VERSION 3.22.1)

project("sunayna-local-engine")

# Options for llama.cpp build
set(GGML_VULKAN ON CACHE BOOL "Vulkan backend")
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "Do not build examples")
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "Do not build server")

# Add llama.cpp as a subdirectory (assuming it's submoduled in real prod)
# add_subdirectory(llama.cpp)

add_library(${PROJECT_NAME} SHARED
    sunayna-local-engine.cpp
)

target_link_libraries(${PROJECT_NAME}
    android
    log
    # llama (native llama.cpp library)
)

# Support 16 KB page sizes
target_link_options(${PROJECT_NAME} PRIVATE "-Wl,-z,max-page-size=16384")
